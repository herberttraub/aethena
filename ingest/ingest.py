"""One-shot literature corpus builder.

Pulls abstracts from Semantic Scholar + protocol pages from bio-protocol,
chunks, embeds via Gemini, writes to corpus_chunks.

Run from project root:
    .venv/Scripts/python.exe -m ingest.ingest
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
import psycopg
import yaml
from readability import Document

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import llm
from api.rag.chunk import chunk_text
from api.rag.s2_client import search_papers, to_corpus_record
from api.settings import settings


def fetch_protocol(url: str) -> str | None:
    """Best-effort scrape — readability extracts main content from HTML."""
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": "hacknation-scientist/0.1"}) as c:
            r = c.get(url)
            if r.status_code != 200:
                return None
            doc = Document(r.text)
            html = doc.summary(html_partial=True)
            # Strip HTML tags crudely
            import re

            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s+", " ", text).strip()
            return text if len(text) > 200 else None
    except Exception as e:
        print(f"  !! protocol fetch failed for {url}: {e}")
        return None


def insert_chunks(records: list[dict]) -> int:
    """Embed each record's text and write to corpus_chunks."""
    if not records:
        return 0
    texts = [r["text"] for r in records]
    print(f"  embedding {len(texts)} chunks...")
    vectors = llm.embed(texts)
    written = 0
    with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn:
        with conn.cursor() as cur:
            for r, v in zip(records, vectors):
                if not v:
                    continue
                vec_str = "[" + ",".join(f"{x:.6f}" for x in v) + "]"
                cur.execute(
                    """
                    insert into corpus_chunks
                        (source, source_id, domain, title, authors, year, chunk_index, text, embedding)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector)
                    """,
                    (
                        r["source"],
                        r.get("source_id") or "",
                        r["domain"],
                        r.get("title") or "",
                        r.get("authors") or "",
                        r.get("year"),
                        r.get("chunk_index", 0),
                        r["text"],
                        vec_str,
                    ),
                )
                written += 1
        conn.commit()
    return written


def already_seeded() -> bool:
    with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) from corpus_chunks")
            (n,) = cur.fetchone()
            return n > 0


def main() -> None:
    if "--force" not in sys.argv and already_seeded():
        print("corpus_chunks already populated; pass --force to re-ingest.")
        return
    if "--force" in sys.argv:
        with psycopg.connect(settings.DATABASE_URL.replace("+psycopg", "")) as conn:
            with conn.cursor() as cur:
                cur.execute("truncate corpus_chunks")
            conn.commit()
        print("truncated corpus_chunks")

    cfg = yaml.safe_load((ROOT / "ingest" / "domains.yaml").read_text())
    grand_total = 0
    for d in cfg["domains"]:
        slug = d["slug"]
        print(f"\n== domain: {slug} ==")

        # 1. Semantic Scholar abstracts
        s2_records: list[dict] = []
        seen_ids: set[str] = set()
        for q in d.get("s2_queries", []):
            print(f"  S2 query: {q!r}")
            try:
                hits = search_papers(q, limit=20)
            except Exception as e:
                print(f"  !! S2 query failed: {e}")
                continue
            for p in hits:
                rec = to_corpus_record(p, slug)
                if not rec:
                    continue
                key = rec["source_id"] or rec["title"]
                if key in seen_ids:
                    continue
                seen_ids.add(key)
                s2_records.append(rec)
            time.sleep(0.6)
        print(f"  -> {len(s2_records)} S2 abstracts retained")

        # 2. Protocol pages
        proto_records: list[dict] = []
        for url in d.get("protocol_urls", []):
            print(f"  protocol: {url}")
            text = fetch_protocol(url)
            if not text:
                continue
            chunks = chunk_text(text, target_words=400, overlap_words=60)
            for i, ch in enumerate(chunks[:8]):
                proto_records.append(
                    {
                        "source": "bio-protocol",
                        "source_id": url,
                        "domain": slug,
                        "title": url.rsplit("/", 1)[-1],
                        "authors": "",
                        "year": None,
                        "chunk_index": i,
                        "text": ch,
                    }
                )
        print(f"  -> {len(proto_records)} protocol chunks retained")

        all_records = s2_records + proto_records
        n = insert_chunks(all_records)
        print(f"  ok wrote {n} chunks for {slug}")
        grand_total += n

    print(f"\n== done. {grand_total} chunks across {len(cfg['domains'])} domains ==")


if __name__ == "__main__":
    main()
