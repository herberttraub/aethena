"""pgvector retrieval over corpus_chunks."""
from __future__ import annotations

from typing import Any

import psycopg

from .. import llm
from ..settings import settings


def _conn_str() -> str:
    return settings.DATABASE_URL.replace("+psycopg", "")


def _to_pgvec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def search_corpus(
    query_text: str,
    *,
    k: int = 8,
    domain: str | None = None,
) -> list[dict[str, Any]]:
    """Cosine-similarity search over corpus_chunks. Returns list of records
    with similarity in [0, 1] (1 = identical)."""
    vecs = llm.embed([query_text])
    if not vecs or not vecs[0]:
        return []
    qv = _to_pgvec(vecs[0])

    sql = """
        select id, source, source_id, domain, title, authors, year, text,
               1 - (embedding <=> %s::vector) as similarity
        from corpus_chunks
        {where}
        order by embedding <=> %s::vector
        limit %s
    """
    where = "where domain = %s" if domain else ""
    params: list[Any] = [qv]
    if domain:
        params.append(domain)
    params.extend([qv, k])
    sql = sql.format(where=where)

    out: list[dict[str, Any]] = []
    with psycopg.connect(_conn_str()) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [c.name for c in cur.description]
        for row in cur.fetchall():
            out.append(dict(zip(cols, row)))
    return out


def search_against_text(query_text: str, source_text: str, *, k: int = 5) -> list[dict[str, Any]]:
    """Ad-hoc retrieval against a user-supplied source (no DB needed).

    Embeds query + source chunks, returns top-k chunks of source by similarity.
    """
    from .chunk import chunk_text

    chunks = chunk_text(source_text, target_words=400, overlap_words=60)[:30]
    if not chunks:
        return []
    vecs = llm.embed([query_text] + chunks)
    if len(vecs) < 2:
        return []
    qv = vecs[0]
    cvs = vecs[1:]

    def cos(a: list[float], b: list[float]) -> float:
        import math

        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a)) or 1.0
        nb = math.sqrt(sum(y * y for y in b)) or 1.0
        return dot / (na * nb)

    scored = [
        {
            "source": "user_source",
            "title": f"User-supplied source · chunk {i + 1}",
            "text": ch,
            "similarity": cos(qv, cvs[i]),
            "source_id": "",
            "authors": "",
            "year": None,
        }
        for i, ch in enumerate(chunks)
    ]
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:k]
