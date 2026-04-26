"""parse-uploads — extract a single combined text summary from uploaded files.

Mirrors the Lovable Supabase function's contract: returns `{summary: str}`.
Best-effort: text-like files read as UTF-8; PDFs via pymupdf; everything else
falls through with a one-line stub. We don't ship the vision-based image
captioning the Supabase version had — it's not on the critical path.
"""
from __future__ import annotations

import io
from typing import Iterable

from ..rag.pdf_extract import extract_pdf_text


MAX_TEXT_PER_FILE = 8000
MAX_TOTAL = 30000


def _is_text_like(name: str, ctype: str) -> bool:
    lower = (name or "").lower()
    if ctype.startswith("text/"):
        return True
    if ctype == "application/json":
        return True
    return any(lower.endswith(ext) for ext in (
        ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yml", ".yaml",
        ".log", ".xml", ".html", ".htm",
    ))


def _is_pdf(name: str, ctype: str) -> bool:
    return "pdf" in (ctype or "").lower() or (name or "").lower().endswith(".pdf")


def parse_files(files: Iterable[tuple[str, str, bytes]]) -> str:
    """Each `files` item is (filename, content_type, raw_bytes). Returns one summary."""
    parts: list[str] = []
    total = 0

    for name, ctype, raw in files:
        snippet = ""
        try:
            if _is_pdf(name, ctype):
                snippet = extract_pdf_text(raw)
            elif _is_text_like(name, ctype):
                snippet = raw.decode("utf-8", errors="ignore")
            else:
                snippet = f"[binary file '{name}' ({len(raw)} bytes) — content not parsed]"
        except Exception as e:
            snippet = f"[error parsing '{name}': {e}]"

        snippet = snippet[:MAX_TEXT_PER_FILE].strip()
        if snippet:
            parts.append(f"--- {name} ---\n{snippet}")
            total += len(snippet)
        if total >= MAX_TOTAL:
            break

    return "\n\n".join(parts)[:MAX_TOTAL]
