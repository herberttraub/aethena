"""QC verdict — given retrieved references, classify novelty.

Three flows feed into one verdict function:
1. Indexed corpus retrieval (default /qc)
2. User-supplied source retrieval (/qc/with-source)
3. Ungrounded LLM (/qc/broad) — bypasses verdict, model speaks directly with [ungrounded] tags
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from textwrap import dedent

from .. import cache
from .. import llm
from ..rag import retriever
from ..rag.pdf_extract import fetch_url_as_text
from ..rag.s2_client import search_papers, to_corpus_record
from ..schemas.qc import QCResult, Reference
from ..settings import settings


_MOCK_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "mock_responses"


def _qc_demo_match(question: str) -> QCResult | None:
    """Return cached QC result when DEMO_MODE is on and the question matches."""
    if not settings.DEMO_MODE:
        return None
    q = question.lower()
    keys = {
        "qc_crp.json": ["crp", "c-reactive protein", "biosensor", "anti-crp"],
        "qc_cryo.json": ["trehalose", "cryoprotectant", "hela", "post-thaw"],
        "qc_gut.json": ["lactobacillus", "intestinal permeability", "fitc-dextran", "claudin"],
        "qc_co2.json": ["sporomusa", "ovata", "bioelectrochemical", "co2"],
    }
    for fname, kws in keys.items():
        if sum(1 for kw in kws if kw in q) >= 2:
            path = _MOCK_DIR / fname
            if path.exists():
                try:
                    return QCResult.model_validate(json.loads(path.read_text(encoding="utf-8")))
                except Exception:
                    return None
    return None


VERDICT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {
            "type": "string",
            "enum": ["not_found", "similar_work_exists", "exact_match_found"],
        },
        "novelty_score": {"type": "number"},
        "rationale": {"type": "string"},
        "best_ref_indices": {
            "type": "array",
            "items": {"type": "integer"},
            "description": "Indices into the input refs list, ordered by relevance, max 3.",
        },
    },
    "required": ["status", "novelty_score", "rationale", "best_ref_indices"],
}


VERDICT_SYSTEM = dedent(
    """
    You are a senior research methods reviewer. You are shown a scientist's
    hypothesis and a set of literature references retrieved by similarity search.
    Decide if the *exact* experiment has been done before, if similar work exists,
    or if the question appears genuinely novel.

    Output strict JSON matching the schema. Voice: terse, factual, methods-section
    register. No "Great question", no exclamation points, no emojis.

    Calibration:
      exact_match_found  -> the same intervention + measurement exists in the refs
      similar_work_exists -> overlapping methods or near-identical hypothesis
      not_found          -> refs are tangential or off-topic

    novelty_score: 1.0 = totally novel, 0.0 = exact published match.
    """
).strip()


def _refs_block(records: list[dict]) -> str:
    lines = []
    for i, r in enumerate(records):
        title = r.get("title") or "(untitled)"
        year = r.get("year") or ""
        sim = r.get("similarity") or 0.0
        snippet = (r.get("text") or "")[:600].replace("\n", " ")
        lines.append(f"[{i}] ({year}) sim={sim:.2f}  {title}\n     {snippet}")
    return "\n\n".join(lines)


def _to_reference(r: dict, similarity_override: float | None = None) -> Reference:
    return Reference(
        title=r.get("title") or "",
        authors=r.get("authors") or "",
        year=r.get("year"),
        source=r.get("source") or "",
        source_id=r.get("source_id") or "",
        url=r.get("source_id") if (r.get("source_id") or "").startswith("http") else "",
        similarity=similarity_override if similarity_override is not None else float(r.get("similarity") or 0.0),
        snippet=(r.get("text") or "")[:300],
    )


def _cosine(a: list[float], b: list[float]) -> float:
    import math

    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def _score_records_with_embeddings(question: str, records: list[dict], *, limit: int) -> list[dict]:
    """Attach query-to-abstract similarity to live Semantic Scholar records."""
    if not records:
        return []
    texts = [question] + [r["text"] for r in records]
    vecs = llm.embed(texts)
    if len(vecs) < 2 or not vecs[0]:
        return records[:limit]

    qv = vecs[0]
    query_terms = {
        term
        for term in re.findall(r"[a-z0-9]+", question.lower())
        if len(term) > 3 and term not in {"want", "create", "make", "build", "develop"}
    }
    scored: list[dict] = []
    for r, v in zip(records, vecs[1:]):
        next_r = dict(r)
        semantic_sim = _cosine(qv, v) if v else 0.0
        rank_bonus = 1.0 / (1.0 + float(next_r.get("_s2_rank") or 0))
        title_terms = set(re.findall(r"[a-z0-9]+", (next_r.get("title") or "").lower()))
        keyword_overlap = (
            len(query_terms & title_terms) / max(1, len(query_terms))
            if query_terms
            else 0.0
        )
        next_r["similarity"] = (0.65 * semantic_sim) + (0.25 * rank_bonus) + (0.10 * keyword_overlap)
        scored.append(next_r)
    scored.sort(key=lambda r: r.get("similarity") or 0.0, reverse=True)
    return scored[:limit]


def _semantic_scholar_queries(question: str) -> list[str]:
    """Convert conversational input into literature-search-shaped queries."""
    q = question.strip()
    cleaned = q.lower()
    cleaned = re.sub(
        r"\b(i\s+want\s+to|i\s+wanna|i\s+would\s+like\s+to|can\s+i|could\s+i|let'?s|please)\b",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"\b(create|make|build|develop|invent|study|test|check|run)\b", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9+\- ]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    queries: list[str] = []
    if "covid" in cleaned and "vaccine" in cleaned:
        queries.extend(
            [
                "COVID vaccine",
                "SARS-CoV-2 vaccine development efficacy",
                "COVID-19 vaccine SARS-CoV-2 mRNA adenovirus protein subunit",
            ]
        )
    queries.extend([cleaned, q])

    out: list[str] = []
    seen: set[str] = set()
    for item in queries:
        item = item.strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _semantic_scholar_fallback(question: str, *, limit: int = 8) -> list[dict]:
    """Live literature fallback for questions outside the local demo corpus.

    These records are intentionally not inserted into corpus_chunks. The local
    index stays as a small curated cache; live S2 results are query-scoped.
    """
    records: list[dict] = []
    seen: set[str] = set()
    for query in _semantic_scholar_queries(question):
        papers = search_papers(query, limit=limit)
        for paper_rank, paper in enumerate(papers):
            rec = to_corpus_record(paper, domain="semantic_scholar_live")
            if not rec:
                continue
            key = rec.get("source_id") or rec.get("title") or rec["text"][:80]
            if key in seen:
                continue
            seen.add(key)
            rec["_s2_rank"] = paper_rank
            records.append(rec)
            if len(records) >= limit * 2:
                break
        if len(records) >= limit * 2:
            break
    return _score_records_with_embeddings(question, records, limit=limit)


def _heuristic_verdict(question: str, retrieved: list[dict], *, reason: str) -> QCResult:
    """Deterministic backup when the verdict model is unavailable."""
    top = retrieved[0] if retrieved else {}
    top_score = float(top.get("similarity") or 0.0)
    titles = " ".join((r.get("title") or "").lower() for r in retrieved[:3])
    q = question.lower()

    if top_score >= 0.82:
        status = "exact_match_found"
        novelty = 0.15
        signal = "The top retrieved work is a close match to the submitted hypothesis."
    elif top_score >= 0.60 or ("covid" in q and "vaccine" in q and "vaccine" in titles):
        status = "similar_work_exists"
        novelty = 0.45
        signal = "Similar work exists in the retrieved literature."
    else:
        status = "not_found"
        novelty = 0.85
        signal = "The retrieved literature is weakly related, so this exact hypothesis was not found."

    return QCResult(
        status=status,
        novelty_score=novelty,
        rationale=signal,
        references=[_to_reference(r) for r in retrieved[:3]],
    )


def run_verdict(question: str, retrieved: list[dict]) -> QCResult:
    """Given retrieved corpus chunks, classify novelty."""
    if not retrieved:
        return QCResult(
            status="no_indexed_knowledge",
            novelty_score=0.5,
            rationale="No similar literature found in our index.",
            references=[],
            needs_user_choice=True,
            fallback_options=["provide_source", "broad_general_search"],
        )

    prompt = dedent(
        f"""
        HYPOTHESIS
        ----------
        {question.strip()}

        RETRIEVED REFERENCES
        --------------------
        {_refs_block(retrieved)}
        """
    ).strip()

    try:
        out = llm.generate_structured(
            prompt,
            response_schema=VERDICT_SCHEMA,
            system=VERDICT_SYSTEM,
            model=settings.OPENAI_MODEL_FLASH if settings.OPENAI_KEY else settings.GEMINI_MODEL_FLASH,
            provider="openai" if settings.OPENAI_KEY else settings.LLM_PROVIDER,
        )
    except Exception as e:
        reason = e.__class__.__name__
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            reason = "the verdict model quota was exhausted"
        return _heuristic_verdict(question, retrieved, reason=reason)

    best_idxs = (out.get("best_ref_indices") or [])[:3]
    refs = [_to_reference(retrieved[i]) for i in best_idxs if 0 <= i < len(retrieved)]
    return QCResult(
        status=out.get("status", "similar_work_exists"),
        novelty_score=float(out.get("novelty_score", 0.5)),
        rationale=out.get("rationale", ""),
        references=refs,
    )


def run_qc(question: str) -> QCResult:
    """Default flow: local pgvector first, then live Semantic Scholar fallback."""
    cached = _qc_demo_match(question)
    if cached is not None:
        return cached
    cache_key = cache.key(
        "qc_v2",
        {
            "question": question.strip().lower(),
            "threshold": settings.NOVELTY_THRESHOLD,
            "llm_provider": "openai" if settings.OPENAI_KEY else settings.LLM_PROVIDER,
        },
    )
    cached_payload = cache.get(cache_key)
    if cached_payload is not None:
        return QCResult.model_validate(cached_payload)

    hits = retriever.search_corpus(question, k=8)
    if not hits or (hits[0].get("similarity") or 0) < settings.NOVELTY_THRESHOLD:
        try:
            s2_hits = _semantic_scholar_fallback(question, limit=8)
        except Exception:
            s2_hits = []
        if s2_hits:
            result = run_verdict(question, s2_hits)
            result.rationale = (
                "Local index missed; Semantic Scholar live fallback was used. "
                + result.rationale
            )
            cache.set(cache_key, result.model_dump())
            return result

        result = QCResult(
            status="no_indexed_knowledge",
            novelty_score=0.5,
            rationale=(
                "Top retrieval below threshold "
                f"({(hits[0].get('similarity') or 0):.2f} < {settings.NOVELTY_THRESHOLD:.2f}). "
                "We do not have indexed literature on this question."
                if hits
                else "No indexed literature on this question."
            ),
            references=[_to_reference(r) for r in hits[:2]] if hits else [],
            needs_user_choice=True,
            fallback_options=["provide_source", "broad_general_search"],
        )
        cache.set(cache_key, result.model_dump())
        return result

    result = run_verdict(question, hits)
    cache.set(cache_key, result.model_dump())
    return result


def run_qc_with_source(question: str, source_url: str | None = None, source_text: str | None = None) -> QCResult:
    """User supplied a source — retrieve from THAT, plus the indexed corpus."""
    text = source_text or ""
    if source_url and not text:
        try:
            text = fetch_url_as_text(source_url)
        except Exception as e:
            return QCResult(
                status="no_indexed_knowledge",
                novelty_score=0.5,
                rationale=f"Failed to fetch source: {e}",
                needs_user_choice=True,
                fallback_options=["broad_general_search"],
            )

    user_hits = retriever.search_against_text(question, text, k=5)
    corpus_hits = retriever.search_corpus(question, k=4)
    merged = (user_hits or []) + (corpus_hits or [])
    if not merged:
        return QCResult(
            status="not_found",
            novelty_score=0.85,
            rationale="No similar passages found in the supplied source or our index.",
            references=[],
        )
    return run_verdict(question, merged)


BROAD_SYSTEM = dedent(
    """
    You have NO retrieval grounding. You are answering from general knowledge only.

    Every factual claim you make MUST be marked with the literal tag [ungrounded]
    immediately after it. Do not invent specific paper titles, authors, DOIs, or
    catalog numbers — if you must reference work, describe it generally.

    Decide whether the user's hypothesis is likely to have been studied before:
      not_found  /  similar_work_exists  /  exact_match_found

    Voice: terse, factual, methods-section register. No "Great question",
    no exclamation points, no emojis.
    """
).strip()


BROAD_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["not_found", "similar_work_exists", "exact_match_found"]},
        "novelty_score": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["status", "novelty_score", "rationale"],
}


def run_qc_broad(question: str) -> QCResult:
    """No retrieval — straight LLM call. Tag everything [ungrounded]."""
    try:
        out = llm.generate_structured(
            f"HYPOTHESIS\n----------\n{question.strip()}",
            response_schema=BROAD_SCHEMA,
            system=BROAD_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception as e:
        return QCResult(
            status="ungrounded",
            novelty_score=0.5,
            rationale=f"Broad search failed: {e}",
            is_ungrounded=True,
        )

    return QCResult(
        status=out.get("status", "similar_work_exists"),
        novelty_score=float(out.get("novelty_score", 0.5)),
        rationale=out.get("rationale", ""),
        references=[],
        is_ungrounded=True,
    )
