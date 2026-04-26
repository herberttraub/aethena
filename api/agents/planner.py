"""Plan generator. Takes a hypothesis + QC context + (optional) team feedback,
produces a fully-grounded ExperimentPlan that satisfies the 10 interview rules.
"""
from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent
from typing import Any

import psycopg
from pydantic import ValidationError

from .. import cache
from .. import llm
from ..rag import retriever
from ..schemas.plan import ExperimentPlan
from ..settings import settings


FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
MOCK_DIR = FIXTURES_DIR / "mock_responses"


# ─── Demo-mode cache ──────────────────────────────────────────────────────
def _demo_match(question: str) -> dict[str, Any] | None:
    """Fuzzy-match question against known demo inputs."""
    if not MOCK_DIR.exists():
        return None
    q = question.lower()
    keys = {
        "crp_biosensor.json": ["crp", "c-reactive protein", "biosensor", "anti-crp"],
        "probiotic_gut.json": ["lactobacillus", "intestinal permeability", "fitc-dextran", "claudin"],
        "trehalose_cryo.json": ["trehalose", "cryoprotectant", "hela", "post-thaw"],
        "sporomusa_co2.json": ["sporomusa", "ovata", "bioelectrochemical", "co2"],
    }
    for fname, keywords in keys.items():
        path = MOCK_DIR / fname
        if not path.exists():
            continue
        if sum(1 for kw in keywords if kw in q) >= 2:
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
    return None


def _load_fixtures() -> tuple[list[dict], list[dict]]:
    people = json.loads((FIXTURES_DIR / "people.json").read_text(encoding="utf-8"))
    equipment = json.loads((FIXTURES_DIR / "equipment.json").read_text(encoding="utf-8"))
    return people, equipment


# ─── System prompt: ten interview-driven rules + depth persona ────────────
COMMON_RULES = dedent(
    """
    You are generating an experiment plan that a real wet-lab scientist would run.
    The plan must satisfy ALL of the following NON-NEGOTIABLE rules. Failing any
    rule means the plan is wrong, regardless of other quality.

    RULE 1 — Every protocol step ships with a `rationale` (the WHY).
      Never just describe what to do; always say why. e.g.,
      "Use ice bath in acetone — the reaction is exothermic and acetone wets glass
       better than water at -78 C."

    RULE 2 — Always populate `environmental_conditions` (top-level field).
      Temperature range, humidity, light, atmosphere, season sensitivity. Lab
      results have been derailed for months by 'room temperature' that varied
      between summer and winter.

    RULE 3 — For every Material, set `shelf_life_days`, `storage`, and
      `order_priority` (early/middle/late). Reagents go stale; we mark
      time-sensitive ones to be ordered LAST.

    RULE 4 — Numbers are SPECIFIC. Never write "approximately", "about",
      "as needed". Concentrations, volumes, durations, voltages, concentrations
      — give a number. If you cannot ground a specific number, populate
      `open_questions` with what the scientist needs to calibrate.

    RULE 5 — Each protocol step lists `assumed_skills`. If a step requires
      familiarity with, e.g., "operating a potentiostat" or "splitting HeLa
      cells without contamination", LIST IT. Junior lab members get burned by
      assumed knowledge.

    RULE 6 — Mark explicit parallelism. If two steps can run concurrently, use
      `can_run_parallel_with`. Real protocols are not strictly serial.

    RULE 7 — Trust badges. Be especially careful and concrete with timing,
      concentrations, and step ordering — these are the three things scientists
      distrust most in AI-generated plans.

    RULE 8 — VOICE: senior postdoc dictating a methods section. Terse, factual,
      precise. BANNED: "Great question", "Certainly!", "I'd be happy to",
      "Let's dive in", emojis, exclamation points, sign-offs, hedging
      intensifiers ("really", "very", "quite"). No flattery.

    RULE 9 — Every Material has `catalog_no`, `supplier`, and `supplier_url`
      where possible. Rough catalog numbers are better than none — pharm
      scientists' #1 busywork is hunting catalog numbers.

    RULE 10 — Budget calibration anchors:
        small inorganic chem            $50–500
        in-vitro pharm baseline         ~$200
        mouse models / rare reagents    $2,000–20,000
        rare-earth metals               +order of magnitude
      If your budget exceeds the implied scale, populate `budget_justification`.

    GROUNDING RULES
    - For staffing.named_person, ONLY use names from the supplied PEOPLE fixture.
      Do not invent scientists. Match expertise to the step.
    - For equipment.location, ONLY use locations from the supplied EQUIPMENT
      fixture. Do not invent buildings or rooms.
    - For materials, supplier_url should match real domains
      (sigma-aldrich.com, thermofisher.com, idtdna.com, neb.com, etc.) and use
      "/search" or product paths. If unsure of the exact catalog number, leave
      it blank — do not invent.
    - For references, prefer the supplied RETRIEVED_LITERATURE — copy DOIs
      verbatim. Do not fabricate DOIs.
    """
).strip()


DEPTH_PERSONA = {
    "brief": "AUDIENCE: a peer PI who has run similar protocols. Be terse. Rationales 1 sentence each. Skip explanations of common technique. Aim for 5-7 protocol steps.",
    "standard": "AUDIENCE: a senior graduate student in the relevant field. Rationales 2-3 sentences. Include common pitfalls in `notes`. Aim for 8-12 protocol steps.",
    "deep": "AUDIENCE: a first-year research assistant new to wet-lab work. Rationales 3-4 sentences with mechanism. Spell out `assumed_skills` thoroughly — these become prerequisites the RA must learn. Include troubleshooting in `notes`. Aim for 10-15 protocol steps.",
}


def _build_system_prompt(depth: str, people: list[dict], equipment: list[dict]) -> str:
    persona = DEPTH_PERSONA.get(depth, DEPTH_PERSONA["standard"])
    people_block = "\n".join(
        f"- {p['name']} ({p['institution']}) — {', '.join(p['expertise'])}" for p in people
    )
    equip_block = "\n".join(
        f"- {e['name']} ({e.get('model', '')}) @ {e['location']}" for e in equipment
    )
    return f"""{COMMON_RULES}

{persona}

PEOPLE FIXTURE (use these names for staffing, do not invent):
{people_block}

EQUIPMENT FIXTURE (use these locations, do not invent):
{equip_block}

Output strict JSON matching the ExperimentPlan schema. No prose, no preamble."""


# ─── Self-learning few-shot ────────────────────────────────────────────────
def _team_examples(team_id: str | None, domain: str | None) -> list[dict[str, Any]]:
    """Pull this team's prior corrections in the same domain (broader than slug
    matching, so rephrasings still hit). Falls back to last few corrections
    across all domains for this team if no domain match."""
    if not team_id:
        return []
    out: list[dict[str, Any]] = []
    try:
        with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn, conn.cursor() as cur:
            if domain:
                cur.execute(
                    """
                    select section, before, after, freeform_note
                    from feedback
                    where team_id = %s and accepted = true and domain = %s
                    order by created_at desc
                    limit 5
                    """,
                    (team_id, domain),
                )
                for section, before, after, note in cur.fetchall():
                    out.append({"section": section, "before": before or "", "after": after or "", "note": note or ""})
            if not out:
                cur.execute(
                    "select section, before, after, freeform_note from feedback where team_id = %s and accepted = true order by created_at desc limit 3",
                    (team_id,),
                )
                for section, before, after, note in cur.fetchall():
                    out.append({"section": section, "before": before or "", "after": after or "", "note": note or ""})
    except Exception:
        return []
    return out


def _feedback_stamp(team_id: str | None) -> dict[str, Any]:
    if not team_id:
        return {"count": 0, "latest": ""}
    try:
        with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn, conn.cursor() as cur:
            cur.execute(
                "select count(*), max(created_at) from feedback where team_id = %s and accepted = true",
                (team_id,),
            )
            count, latest = cur.fetchone()
            return {"count": int(count or 0), "latest": latest.isoformat() if latest else ""}
    except Exception:
        return {"count": 0, "latest": ""}


def _classify_experiment_type(question: str) -> str:
    """Tiny call to slug the experiment type for the few-shot store."""
    try:
        provider = "openai" if settings.OPENAI_KEY else settings.LLM_PROVIDER
        return llm.generate_text(
            f"Classify this experiment into a 3-5 word slug, lowercase, dot-separated. e.g. 'biosensor.electrochemical.crp', 'mouse.gut.permeability', 'cryopreservation.cell.viability', 'microbe.electrosynthesis.co2'. Output ONLY the slug, no explanation.\n\nHYPOTHESIS:\n{question}",
            system="You output exactly one slug. Nothing else.",
            model=settings.OPENAI_MODEL_FLASH if settings.OPENAI_KEY else settings.GEMINI_MODEL_FLASH,
            provider=provider,
        ).strip().splitlines()[0][:80]
    except Exception:
        return "general"


# ─── Domain hint for retrieval ─────────────────────────────────────────────
def _domain_hint(experiment_type: str) -> str | None:
    et = experiment_type.lower()
    if any(k in et for k in ["crp", "biosensor", "electrochem"]):
        return "diagnostics_crp_biosensor"
    if any(k in et for k in ["gut", "permeability", "probiotic", "lactobacillus"]):
        return "gut_health_probiotic"
    if any(k in et for k in ["cryo", "trehalose", "freez"]):
        return "cell_biology_cryo"
    if any(k in et for k in ["co2", "sporomusa", "electrosynthesis", "acetate"]):
        return "climate_co2_microbe"
    return None


# ─── Main entry point ─────────────────────────────────────────────────────
def generate_plan(
    question: str,
    *,
    depth: str = "standard",
    team_id: str | None = None,
    qc_status: str = "",
    qc_rationale: str = "",
    qc_references: list[dict] | None = None,
) -> dict[str, Any]:
    if settings.DEMO_MODE:
        cached = _demo_match(question)
        if cached:
            from . import supplier_links

            cached_plan = cached["plan"]
            cached_plan["materials"] = supplier_links.canonicalize_materials(cached_plan.get("materials") or [])
            if isinstance(cached_plan.get("budget"), dict):
                cached_plan["budget"]["line_items"] = supplier_links.canonicalize_materials(
                    cached_plan["budget"].get("line_items") or []
                )
            return {
                "plan": cached_plan,
                "experiment_type": cached.get("experiment_type", "demo"),
                "domain": cached.get("domain"),
                "grounding_used": 0,
                "team_examples_applied": 0,
                "demo_cached": True,
            }

    plan_cache_key = cache.key(
        "plan_v2",
        {
            "question": question.strip().lower(),
            "depth": depth,
            "team_id": team_id or "",
            "qc_status": qc_status,
            "qc_rationale": qc_rationale,
            "qc_references": [
                {
                    "title": r.get("title", ""),
                    "source_id": r.get("source_id", ""),
                    "year": r.get("year"),
                }
                for r in (qc_references or [])
            ],
            "feedback": _feedback_stamp(team_id),
            "llm_provider": "openai" if settings.OPENAI_KEY else settings.LLM_PROVIDER,
        },
    )
    cached_plan = cache.get(plan_cache_key)
    if cached_plan is not None:
        cached_plan["response_cached"] = True
        return cached_plan

    people, equipment = _load_fixtures()
    experiment_type = _classify_experiment_type(question)
    domain_hint = _domain_hint(experiment_type)

    # 1. Pull literature grounding
    grounding = retriever.search_corpus(question, k=8, domain=domain_hint)
    grounding_block = "\n\n".join(
        f"[{i}] ({r.get('year')}) {r.get('title')}\nDOI/ID: {r.get('source_id')}\n{(r.get('text') or '')[:500]}"
        for i, r in enumerate(grounding)
    ) or "(no literature retrieved — proceed cautiously)"

    # 2. Pull this team's prior corrections (Self-learning)
    examples = _team_examples(team_id, domain_hint)
    if examples:
        examples_block = "\n\n".join(
            f"[correction {i + 1}] section: {e['section']}\nBEFORE: {e['before'][:400]}\nAFTER:  {e['after'][:400]}\nNOTE:   {e['note'][:300]}"
            for i, e in enumerate(examples)
        )
        examples_intro = "\n\nTHIS TEAM HAS PREVIOUSLY CORRECTED SIMILAR PLANS. Apply equivalent rules wherever applicable:\n\n"
        learning_block = examples_intro + examples_block
    else:
        learning_block = ""

    qc_block = ""
    if qc_status:
        refs_str = "\n".join(
            f"  - {r.get('title', '')} ({r.get('year', '')}) {r.get('source_id', '')}"
            for r in (qc_references or [])
        )
        qc_block = f"\n\nLITERATURE QC RESULT: {qc_status}\nQC RATIONALE: {qc_rationale}\nQC REFERENCES:\n{refs_str}"

    # 3. Compose the user message
    prompt = dedent(
        f"""
        HYPOTHESIS
        ----------
        {question.strip()}

        EXPERIMENT TYPE SLUG: {experiment_type}
        {qc_block}

        RETRIEVED LITERATURE (use for grounding; cite verbatim DOIs):
        ----------------------------------------------------------------
        {grounding_block}
        {learning_block}

        Now produce the full ExperimentPlan JSON. Every field must be filled.
        """
    ).strip()

    system = _build_system_prompt(depth, people, equipment)
    generation_provider = "openai" if settings.OPENAI_KEY else settings.LLM_PROVIDER
    generation_model = settings.OPENAI_MODEL_FLASH if settings.OPENAI_KEY else settings.GEMINI_MODEL_FLASH

    # 4. Generate with structured output
    raw = llm.generate_structured(
        prompt,
        response_schema=ExperimentPlan,
        system=system,
        model=generation_model,
        provider=generation_provider,
    )

    # 5. Validate (and salvage on minor failures)
    try:
        plan = ExperimentPlan.model_validate(raw)
    except ValidationError as e:
        # one repair pass
        repair = llm.generate_structured(
            f"The previous output failed schema validation. Errors:\n{e}\n\nORIGINAL OUTPUT:\n{json.dumps(raw)[:6000]}\n\nFix the JSON to satisfy the schema. Keep all factual content; only fix structure.",
            response_schema=ExperimentPlan,
            system="Output strict JSON. No prose.",
            model=generation_model,
            provider=generation_provider,
        )
        plan = ExperimentPlan.model_validate(repair)

    plan_dict = plan.model_dump()
    # Replace any hallucinated supplier URLs with deterministic, known-good
    # supplier search/product URLs. (No catalog-page 404s.)
    from . import supplier_links

    plan_dict["materials"] = supplier_links.canonicalize_materials(plan_dict.get("materials") or [])
    if isinstance(plan_dict.get("budget"), dict):
        plan_dict["budget"]["line_items"] = supplier_links.canonicalize_materials(
            plan_dict["budget"].get("line_items") or []
        )

    out = {
        "plan": plan_dict,
        "experiment_type": experiment_type,
        "domain": domain_hint,
        "grounding_used": len(grounding),
        "team_examples_applied": len(examples),
    }
    cache.set(plan_cache_key, out)
    return out
