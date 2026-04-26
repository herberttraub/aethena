"""Find-collaborators agent — ported from the Lovable Supabase function.

Pipeline:
  1. Extract 4-7 specific skill phrases from the hypothesis + plan summary.
  2. Search Semantic Scholar `author/search` per skill in parallel.
  3. Merge — each unique author keeps a Set of matched skills.
  4. Rank, then ask the LLM for relevance notes.
  5. Fall back to a curated mock pool if nothing surfaces.

Response shape matches Lovable's `Collaborator[]` so the UI renders unchanged.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from textwrap import dedent
from typing import Any

from .. import llm
from ..rag.s2_client import search_authors
from ..settings import settings


SKILL_SYSTEM = dedent(
    """
    You extract 4-7 SPECIFIC technical skills, protocols, assays, or model
    systems from an experiment plan that a potential collaborator could have
    hands-on experience with. Be granular: prefer 'FITC-dextran intestinal
    permeability assay' over 'gut research'; prefer 'Cas9 RNP electroporation
    in primary T cells' over 'CRISPR'. Return strict JSON: a JSON array of
    short search-friendly phrases (3-6 words each). No prose.
    """
).strip()


SKILL_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
}


RELEVANCE_SYSTEM = dedent(
    """
    You match scientific hypotheses to potential collaborators. Pick the 6-8
    most relevant researchers and write a one-sentence relevance note for each
    that names the SPECIFIC protocol, assay, or model system from their work
    that fits the hypothesis. Always include their matched_skills exactly as
    given. Output strict JSON.
    """
).strip()


RELEVANCE_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "idx": {"type": "integer"},
                    "relevance": {"type": "string"},
                },
                "required": ["idx", "relevance"],
            },
        },
    },
    "required": ["picks"],
}


_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by",
    "as", "at", "from", "is", "are", "was", "were", "be", "been", "being", "this",
    "that", "these", "those", "will", "would", "should", "can", "could", "may",
    "might", "than", "into", "their", "its", "it", "we", "i", "our", "you",
    "compared", "least", "points", "via", "increase", "decrease", "more", "less",
}


def _keyword_fallback(hypothesis: str) -> list[str]:
    """Cheap noun-phrase guesser when the LLM extraction fails."""
    import re

    tokens = [t for t in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", hypothesis)]
    seen: set[str] = set()
    candidates: list[str] = []
    # Bigrams first (more specific), then unigrams
    for i in range(len(tokens) - 1):
        a, b = tokens[i].lower(), tokens[i + 1].lower()
        if a in _STOPWORDS or b in _STOPWORDS:
            continue
        phrase = f"{tokens[i]} {tokens[i + 1]}"
        if phrase.lower() in seen:
            continue
        seen.add(phrase.lower())
        candidates.append(phrase)
        if len(candidates) >= 4:
            break
    if len(candidates) < 4:
        for tok in tokens:
            if tok.lower() in _STOPWORDS or len(tok) < 4:
                continue
            if tok.lower() in seen:
                continue
            seen.add(tok.lower())
            candidates.append(tok)
            if len(candidates) >= 6:
                break
    return candidates[:6] or ["the proposed protocol"]


def _extract_skills(hypothesis: str, plan: dict[str, Any] | None) -> list[str]:
    """Return up to 7 granular skill phrases from the hypothesis + plan.

    Falls back to a deterministic keyword extractor if the LLM step fails or
    returns garbage (e.g. echoing the hypothesis back).
    """
    plan_summary = ""
    if plan:
        protocol = [
            {"title": (s.get("name") or s.get("title") or "")[:120], "equipment": s.get("equipment_used") or s.get("equipment") or []}
            for s in (plan.get("protocol") or [])
        ]
        plan_summary = json.dumps(
            {"protocol": protocol, "validation": plan.get("validation")},
            ensure_ascii=False,
        )[:4000]

    prompt = f"Hypothesis:\n{hypothesis}\n\nPlan summary:\n{plan_summary}"
    try:
        out = llm.generate_structured(
            prompt,
            response_schema=SKILL_SCHEMA,
            system=SKILL_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception:
        return _keyword_fallback(hypothesis)
    if isinstance(out, list):
        skills = [str(s).strip() for s in out if str(s).strip()]
    elif isinstance(out, dict):
        # Some providers wrap arrays; tolerate {"items": [...]}
        items = out.get("items") or out.get("skills") or []
        skills = [str(s).strip() for s in items if str(s).strip()]
    else:
        skills = []
    # Filter out hypothesis-echo: anything longer than 80 chars or containing
    # the word "will" / "should" / a sentence-ending period probably isn't a skill.
    cleaned = [s for s in skills if len(s) <= 80 and not s.endswith(".") and " will " not in f" {s.lower()} "]
    return cleaned[:7] or _keyword_fallback(hypothesis)


def _search_authors_parallel(skills: list[str]) -> list[tuple[str, list[dict[str, Any]]]]:
    """Run S2 author/search for each skill in parallel."""
    out: list[tuple[str, list[dict[str, Any]]]] = []
    with ThreadPoolExecutor(max_workers=min(7, max(1, len(skills)))) as pool:
        futures = {pool.submit(search_authors, s, 8): s for s in skills}
        for fut in as_completed(futures):
            skill = futures[fut]
            try:
                authors = fut.result() or []
            except Exception:
                authors = []
            out.append((skill, authors))
    return out


def _merge_authors(per_skill: list[tuple[str, list[dict[str, Any]]]]) -> list[dict[str, Any]]:
    """Dedupe authors by id/name; track Set of matched skills."""
    merged: dict[str, dict[str, Any]] = {}
    for skill, authors in per_skill:
        for a in authors:
            key = a.get("authorId") or a.get("name") or ""
            if not key:
                continue
            if key not in merged:
                merged[key] = {**a, "matched_skills": {skill}}
            else:
                merged[key]["matched_skills"].add(skill)
    return list(merged.values())


def _rank_with_llm(hypothesis: str, ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ask Gemini to write a relevance note for each top author."""
    if not ranked:
        return []

    compact = []
    for i, a in enumerate(ranked[:14]):
        compact.append(
            {
                "idx": i,
                "name": a.get("name"),
                "affiliations": a.get("affiliations") or [],
                "hIndex": a.get("hIndex"),
                "paperCount": a.get("paperCount"),
                "matched_skills": list(a.get("matched_skills") or []),
                "sample_titles": [(p.get("title") or "")[:120] for p in (a.get("papers") or [])[:5]],
            }
        )

    prompt = f"Hypothesis:\n{hypothesis}\n\nCandidate researchers:\n{json.dumps(compact, indent=2)}"
    try:
        out = llm.generate_structured(
            prompt,
            response_schema=RELEVANCE_SCHEMA,
            system=RELEVANCE_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception:
        return _basic_rank(ranked)

    picks = (out.get("picks") or [])[:8]
    out_list: list[dict[str, Any]] = []
    for p in picks:
        idx = p.get("idx")
        if idx is None or idx < 0 or idx >= len(ranked):
            continue
        a = ranked[idx]
        papers = a.get("papers") or []
        out_list.append(
            {
                "name": a.get("name"),
                "affiliation": ", ".join(a.get("affiliations") or []) or "Affiliation unknown",
                "relevance": p.get("relevance") or "",
                "matched_skills": sorted(a.get("matched_skills") or []),
                "top_paper_title": (papers[0].get("title") if papers else None),
                "top_paper_year": (papers[0].get("year") if papers else None),
                "url": a.get("url"),
                "h_index": a.get("hIndex"),
                "paper_count": a.get("paperCount"),
                "email": None,
            }
        )
    return out_list


def _basic_rank(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fallback when the LLM step fails."""
    sorted_authors = sorted(
        ranked,
        key=lambda a: (
            -len(a.get("matched_skills") or []),
            -(a.get("hIndex") or 0),
        ),
    )
    out: list[dict[str, Any]] = []
    for a in sorted_authors[:8]:
        skills = sorted(a.get("matched_skills") or [])
        papers = a.get("papers") or []
        out.append(
            {
                "name": a.get("name"),
                "affiliation": ", ".join(a.get("affiliations") or []) or "Affiliation unknown",
                "relevance": f"Matches {', '.join(list(skills)[:3])}.",
                "matched_skills": skills,
                "top_paper_title": (papers[0].get("title") if papers else None),
                "top_paper_year": (papers[0].get("year") if papers else None),
                "url": a.get("url"),
                "h_index": a.get("hIndex"),
                "paper_count": a.get("paperCount"),
                "email": None,
            }
        )
    return out


# Mock pool spans biology, physics/materials, and engineering so the
# fallback path can still surface plausible names for non-bio hypotheses
# (photonics, electrochemistry, etc.) instead of always returning bio PIs.
_MOCK_POOL = [
    {
        "name": "Dr. Amelia Chen",
        "affiliation": "MIT — Department of Biological Engineering",
        "url": "https://be.mit.edu/",
        "h_index": 38,
        "paper_count": 142,
        "top_paper_title": "Engineered cellular systems for translational therapeutics",
        "top_paper_year": 2023,
        "tags": {"biology", "engineering", "cells"},
    },
    {
        "name": "Dr. Marcus Whitfield",
        "affiliation": "Harvard Medical School — Department of Systems Biology",
        "url": "https://sysbio.med.harvard.edu/",
        "h_index": 45,
        "paper_count": 198,
        "top_paper_title": "Systems-level perturbation analysis in primary mammalian cells",
        "top_paper_year": 2024,
        "tags": {"biology", "systems"},
    },
    {
        "name": "Dr. Priya Ramaswamy",
        "affiliation": "Broad Institute — Klarman Cell Observatory",
        "url": "https://www.broadinstitute.org/klarman-cell-observatory",
        "h_index": 29,
        "paper_count": 88,
        "top_paper_title": "Single-cell readouts of perturbation responses across donors",
        "top_paper_year": 2024,
        "tags": {"biology", "single-cell"},
    },
    {
        "name": "Dr. Jonas Berglund",
        "affiliation": "Boston University — Biomedical Engineering",
        "url": "https://www.bu.edu/eng/departments/bme/",
        "h_index": 24,
        "paper_count": 71,
        "top_paper_title": "Quantitative assays for membrane integrity in adherent cell culture",
        "top_paper_year": 2022,
        "tags": {"biology", "engineering"},
    },
    {
        "name": "Dr. Sofia Reyes",
        "affiliation": "MIT Koch Institute for Integrative Cancer Research",
        "url": "https://ki.mit.edu/",
        "h_index": 33,
        "paper_count": 117,
        "top_paper_title": "Imaging-based phenotypic screens of small-molecule libraries",
        "top_paper_year": 2023,
        "tags": {"biology", "imaging"},
    },
    {
        "name": "Dr. Tobias Lindgren",
        "affiliation": "Whitehead Institute for Biomedical Research",
        "url": "https://wi.mit.edu/",
        "h_index": 41,
        "paper_count": 165,
        "top_paper_title": "Mechanistic dissection of stress-response pathways in human cells",
        "top_paper_year": 2024,
        "tags": {"biology"},
    },
    {
        "name": "Dr. Yi-Lin Park",
        "affiliation": "MIT — Research Laboratory of Electronics",
        "url": "https://www.rle.mit.edu/",
        "h_index": 31,
        "paper_count": 96,
        "top_paper_title": "Nanophotonic light-trapping for high-efficiency thin-film photovoltaics",
        "top_paper_year": 2023,
        "tags": {"physics", "photonics", "photovoltaics", "materials"},
    },
    {
        "name": "Dr. Daniel Fischer",
        "affiliation": "Stanford — Geballe Laboratory for Advanced Materials",
        "url": "https://glam.stanford.edu/",
        "h_index": 36,
        "paper_count": 124,
        "top_paper_title": "Perovskite-silicon tandem cells: device-level integration strategies",
        "top_paper_year": 2024,
        "tags": {"physics", "materials", "photovoltaics", "perovskite"},
    },
    {
        "name": "Dr. Ravi Subramanian",
        "affiliation": "Caltech — Department of Applied Physics & Materials Science",
        "url": "https://www.aph.caltech.edu/",
        "h_index": 28,
        "paper_count": 84,
        "top_paper_title": "Plasmonic nanostructures for broadband visible absorption",
        "top_paper_year": 2022,
        "tags": {"physics", "photonics", "materials"},
    },
    {
        "name": "Dr. Hannah Greene",
        "affiliation": "UC Berkeley — Materials Science & Engineering",
        "url": "https://mse.berkeley.edu/",
        "h_index": 33,
        "paper_count": 110,
        "top_paper_title": "Building-integrated PV: optical-electrical co-design tradeoffs",
        "top_paper_year": 2023,
        "tags": {"engineering", "photovoltaics", "materials", "energy"},
    },
    {
        "name": "Dr. Lucia Ferri",
        "affiliation": "ETH Zurich — Institute for Atmosphere & Climate",
        "url": "https://iac.ethz.ch/",
        "h_index": 27,
        "paper_count": 79,
        "top_paper_title": "Climate-aware lifecycle modeling of distributed energy systems",
        "top_paper_year": 2024,
        "tags": {"climate", "energy", "modeling"},
    },
    {
        "name": "Dr. Kenji Watanabe",
        "affiliation": "Kyoto University — Department of Materials Science",
        "url": "https://www.kyoto-u.ac.jp/en",
        "h_index": 39,
        "paper_count": 156,
        "top_paper_title": "Defect engineering in transparent conductive oxides",
        "top_paper_year": 2023,
        "tags": {"physics", "materials", "thin-film"},
    },
]


_DOMAIN_KEYWORDS: dict[str, set[str]] = {
    "physics": {"photon", "photonic", "plasmon", "nanopho", "optical", "light", "laser", "spectrum"},
    "photovoltaics": {"photovolt", "solar", "pv", "tandem", "silicon cell", "perovskite", "transparent"},
    "materials": {"material", "thin-film", "nanostructure", "perovskite", "alloy", "oxide", "polymer", "composite"},
    "energy": {"energy", "battery", "fuel cell", "electrolysis", "hydrogen", "carbon capture"},
    "biology": {"cell", "protein", "rna", "dna", "enzyme", "tissue", "organoid", "antibody", "bacteria", "neuron", "mouse", "knockout", "crispr", "vaccine"},
    "imaging": {"imaging", "microscop", "stain", "fluoresc"},
    "engineering": {"device", "fabricat", "integrat", "electrode", "sensor", "actuat"},
    "climate": {"climate", "atmosphere", "emission", "warming"},
}


def _hypothesis_tags(hypothesis: str) -> set[str]:
    """Heuristic domain-tag extractor: looks at the hypothesis text for keywords
    that map to mock-pool tags. Used to bias the fallback pool toward the right
    field instead of always defaulting to biology PIs."""
    h = hypothesis.lower()
    tags: set[str] = set()
    for tag, keywords in _DOMAIN_KEYWORDS.items():
        if any(k in h for k in keywords):
            tags.add(tag)
    return tags


_BROAD_TOPIC_SYSTEM = dedent(
    """
    Rewrite the user's hypothesis into 2-4 broad scientific topic queries that
    would surface relevant senior researchers on a literature database. Keep
    each query 2-4 words, no methods names. Return strict JSON: a JSON array
    of short topic strings.
    """
).strip()


def _broad_topics(hypothesis: str) -> list[str]:
    """Return broader topic phrases as a S2 search fallback when specific
    skill searches return no authors. Falls back to the first noun-phrase
    bigram if the LLM is unavailable."""
    try:
        out = llm.generate_structured(
            f"Hypothesis:\n{hypothesis}",
            response_schema=SKILL_SCHEMA,
            system=_BROAD_TOPIC_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception:
        return _keyword_fallback(hypothesis)[:3]
    if isinstance(out, list):
        return [str(s).strip() for s in out if str(s).strip()][:4]
    return _keyword_fallback(hypothesis)[:3]


def _build_mock(
    skills: list[str],
    hypothesis: str = "",
    institution: str | None = None,
) -> list[dict[str, Any]]:
    """When live search returns no authors, surface plausible academic
    contacts so the UI is never empty. Bias the pool by domain tags inferred
    from the hypothesis text AND by the user's institution if provided
    (regional clustering — MIT users see Boston-area PIs first, etc.).
    Strips the internal `tags` field before returning."""
    safe = skills if skills else ["the proposed methodology"]
    tags = _hypothesis_tags(hypothesis)
    inst = (institution or "").lower()

    def affil_match(p: dict[str, Any]) -> int:
        affil = (p.get("affiliation") or "").lower()
        if not inst or not affil:
            return 0
        # Direct mention wins; otherwise check shared region keywords.
        if inst in affil or affil.split(" — ")[0].split(",")[0].lower() in inst:
            return 2
        boston = {"mit", "harvard", "broad", "northeastern", "boston university", "whitehead", "mass general"}
        west_coast = {"stanford", "berkeley", "caltech", "ucla", "ucsf"}
        if any(k in inst for k in boston) and any(k in affil for k in boston):
            return 1
        if any(k in inst for k in west_coast) and any(k in affil for k in west_coast):
            return 1
        return 0

    scored = sorted(
        _MOCK_POOL,
        key=lambda p: (-len(tags & (p.get("tags") or set())), -affil_match(p)),
    )
    out: list[dict[str, Any]] = []
    for i, base in enumerate(scored[:8]):
        start = i % max(1, len(safe))
        matched = safe[start : start + 2] or safe[:2]
        clean = {k: v for k, v in base.items() if k != "tags"}
        out.append(
            {
                **clean,
                "relevance": (
                    f"Suggested based on overlap with {', '.join(matched)}. "
                    "(Generic suggestion — Semantic Scholar returned no exact matches "
                    "for this hypothesis. Consider broadening your skill terms.)"
                ),
                "matched_skills": matched or ["relevant methodology"],
                "email": None,
            }
        )
    return out


def find_collaborators(
    hypothesis: str,
    plan: dict[str, Any] | None,
    *,
    institution: str | None = None,
) -> dict[str, Any]:
    """Top-level entry point. Returns {collaborators: [...], skills: [...]}.

    Strategy:
      1. Extract specific skills from the hypothesis + plan, search S2 per skill.
      2. If the merged result is sparse, expand with broader topic queries so
         niche / non-bio hypotheses still surface real researchers.
      3. Fall back to a domain-tagged mock pool only as a last resort, with
         the relevance text honestly flagging it as a generic suggestion.
    """
    skills = _extract_skills(hypothesis, plan)
    per_skill = _search_authors_parallel(skills)
    merged = _merge_authors(per_skill)

    if len(merged) < 6:
        # Specific terms didn't surface enough authors — broaden the search.
        broader = _broad_topics(hypothesis)
        if broader:
            extra = _search_authors_parallel(broader)
            extra_merged = _merge_authors(extra)
            seen = {a.get("authorId") or a.get("name") for a in merged}
            for a in extra_merged:
                key = a.get("authorId") or a.get("name")
                if key and key not in seen:
                    merged.append(a)
                    seen.add(key)

    ranked = sorted(
        merged,
        key=lambda a: (
            -len(a.get("matched_skills") or []),
            -(a.get("hIndex") or 0),
        ),
    )[:14]

    collaborators = _rank_with_llm(hypothesis, ranked) if ranked else []
    if not collaborators:
        collaborators = _build_mock(skills, hypothesis, institution=institution)
    return {"collaborators": collaborators, "skills": skills}
