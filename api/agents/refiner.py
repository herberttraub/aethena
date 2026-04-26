"""Refiner agent — decides whether to accept a scientist's correction.

Rejection rubric (scientist's hallucinations are a real risk):
  - Unsafe concentration / volume / temperature
  - Impossible timeline ("centrifuge for -1 minutes")
  - Direct contradiction of cited protocol
Anything else is accepted, stored, and fed back via few-shot in next gen.
"""
from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

import psycopg

from .. import llm
from ..settings import settings


REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "accepted": {"type": "boolean"},
        "reason": {"type": "string", "description": "If rejected: why. If accepted: empty."},
        "experiment_type": {"type": "string"},
    },
    "required": ["accepted", "reason"],
}


REVIEW_SYSTEM = dedent(
    """
    You are a careful protocol reviewer. A scientist has proposed a correction to
    a generated experiment plan. Decide if the correction can be applied as-is.

    REJECT only if the correction is one of:
      - obviously unsafe (e.g. "use 100M HCl", "skip PPE", "skip incubation entirely")
      - logically impossible (e.g. negative durations, missing controls that the
        hypothesis requires)
      - in direct contradiction of cited literature

    Otherwise, ACCEPT. Scientists know their lab better than we do.

    When you reject, give the scientist a short, respectful reason in their
    register — methods-section voice, no flattery. State what would make the
    suggestion acceptable.

    Output strict JSON.
    """
).strip()


def review_feedback(
    *,
    plan: dict[str, Any],
    section: str,
    before: str | None,
    after: str | None,
    freeform_note: str | None,
) -> dict[str, Any]:
    """Returns {accepted, reason}."""
    if settings.DEMO_MODE:
        return {"accepted": True, "reason": ""}
    section_blob = json.dumps(plan.get(section), indent=2) if isinstance(plan.get(section), (list, dict)) else str(plan.get(section, ""))
    prompt = dedent(
        f"""
        SECTION: {section}

        CURRENT CONTENT (excerpt):
        {section_blob[:2500]}

        SCIENTIST'S CORRECTION
        ----------------------
        BEFORE: {before or "(no excerpt)"}
        AFTER:  {after or "(no excerpt)"}
        NOTE:   {freeform_note or "(none)"}

        Decide: accept or reject?
        """
    ).strip()

    try:
        out = llm.generate_structured(
            prompt,
            response_schema=REVIEW_SCHEMA,
            system=REVIEW_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception:
        # Default to accept on review failure — better to learn than lose feedback
        return {"accepted": True, "reason": ""}
    return {"accepted": bool(out.get("accepted", True)), "reason": out.get("reason", "")}


REFINE_SCHEMA = {
    "type": "object",
    "properties": {
        "updated_text": {"type": "string"},
    },
    "required": ["updated_text"],
}


REFINE_SYSTEM = dedent(
    """
    You are revising one section of an experiment plan. Apply the requested
    change. Keep all the interview rules in force:
      - rationale on every step
      - specific numbers, no hedging
      - methods-section voice — no sycophancy, no emojis

    Output strict JSON: { "updated_text": "..." }
    """
).strip()


def refine_section(
    *,
    plan: dict[str, Any],
    section: str,
    instruction: str,
    freeform_note: str | None = None,
) -> str:
    """Apply more_detail / less_detail / freeform to one plan section.
    Returns plain markdown-ish updated text."""
    section_blob = json.dumps(plan.get(section), indent=2) if isinstance(plan.get(section), (list, dict)) else str(plan.get(section, ""))

    instr_text = {
        "more_detail": "Expand this section with more concrete detail. Add a step-by-step rationale, surface assumed skills, and add any troubleshooting notes that would help a junior RA.",
        "less_detail": "Tighten this section. Remove explanatory text a senior PI would already know. Keep the specific numbers.",
        "freeform": f"Apply this change: {freeform_note or ''}",
    }.get(instruction, freeform_note or "Improve this section.")

    prompt = f"SECTION: {section}\n\nCURRENT:\n{section_blob[:3500]}\n\nCHANGE: {instr_text}"
    out = llm.generate_structured(
        prompt,
        response_schema=REFINE_SCHEMA,
        system=REFINE_SYSTEM,
        model=settings.GEMINI_MODEL_FLASH,
    )
    return out.get("updated_text", "")


# ─── DB helpers ────────────────────────────────────────────────────────────
def store_feedback(
    *,
    plan_id: str,
    team_id: str | None,
    experiment_type: str | None,
    domain: str | None,
    section: str,
    before: str | None,
    after: str | None,
    freeform_note: str | None,
    accepted: bool,
    reason: str,
) -> None:
    with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn, conn.cursor() as cur:
        if team_id:
            cur.execute(
                "insert into teams (id, name) values (%s, %s) on conflict (id) do nothing",
                (team_id, "Lab"),
            )
        cur.execute(
            """
            insert into feedback
                (plan_id, team_id, experiment_type, domain, section, before, after, freeform_note, accepted, reason)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (plan_id, team_id, experiment_type, domain, section, before, after, freeform_note, accepted, reason),
        )
        conn.commit()


def fetch_plan_row(plan_id: str) -> dict[str, Any] | None:
    with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn, conn.cursor() as cur:
        cur.execute(
            """
            select p.id, p.team_id, p.plan, q.experiment_type, q.domain
            from plans p
            left join queries q on q.id = p.query_id
            where p.id = %s
            """,
            (plan_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "team_id": row[1], "plan": row[2], "experiment_type": row[3], "domain": row[4]}
