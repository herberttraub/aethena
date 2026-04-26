"""Thin Semantic Scholar API client.

Works without an API key (rate-limited to ~100 req / 5min); SEMANTIC_SCHOLAR_KEY
in .env raises that limit.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..settings import settings

BASE = "https://api.semanticscholar.org/graph/v1"
DEFAULT_FIELDS = "paperId,title,abstract,authors,year,venue,externalIds,url,citationCount"


def _headers() -> dict[str, str]:
    h = {"User-Agent": "hacknation-scientist/0.1"}
    if settings.SEMANTIC_SCHOLAR_KEY:
        h["x-api-key"] = settings.SEMANTIC_SCHOLAR_KEY
    return h


def search_papers(query: str, limit: int = 50, fields: str = DEFAULT_FIELDS) -> list[dict[str, Any]]:
    """paper/search — bulk relevance-ranked results."""
    params = {"query": query, "limit": str(limit), "fields": fields}
    with httpx.Client(timeout=30.0, headers=_headers()) as c:
        for attempt in range(4):
            r = c.get(f"{BASE}/paper/search", params=params)
            if r.status_code == 200:
                return (r.json() or {}).get("data") or []
            if r.status_code in (429, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            r.raise_for_status()
    return []


AUTHOR_FIELDS = "name,affiliations,hIndex,paperCount,url,papers.title,papers.year"


def search_authors(query: str, limit: int = 8, fields: str = AUTHOR_FIELDS) -> list[dict[str, Any]]:
    """author/search — relevance-ranked author results, used by the collaborators agent."""
    params = {"query": query, "limit": str(limit), "fields": fields}
    with httpx.Client(timeout=30.0, headers=_headers()) as c:
        for attempt in range(4):
            r = c.get(f"{BASE}/author/search", params=params)
            if r.status_code == 200:
                return (r.json() or {}).get("data") or []
            if r.status_code in (429, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
            r.raise_for_status()
    return []


def to_corpus_record(paper: dict[str, Any], domain: str) -> dict[str, Any] | None:
    """Project an S2 paper into the corpus_chunks shape (one chunk per abstract)."""
    abstract = (paper.get("abstract") or "").strip()
    title = (paper.get("title") or "").strip()
    if not abstract or len(abstract) < 80:
        return None
    authors = ", ".join(a.get("name", "") for a in (paper.get("authors") or [])[:6])
    doi = (paper.get("externalIds") or {}).get("DOI")
    src_id = doi or paper.get("paperId") or paper.get("url") or ""
    text = f"{title}\n\n{abstract}"
    return {
        "source": "semantic_scholar",
        "source_id": src_id,
        "domain": domain,
        "title": title,
        "authors": authors,
        "year": paper.get("year"),
        "chunk_index": 0,
        "text": text,
    }
