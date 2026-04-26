"""PDF text extraction via pymupdf."""
from __future__ import annotations

import io


def extract_pdf_text(pdf_bytes: bytes) -> str:
    import fitz  # pymupdf

    pages: list[str] = []
    with fitz.open(stream=io.BytesIO(pdf_bytes), filetype="pdf") as doc:
        for page in doc:
            pages.append(page.get_text("text") or "")
    return "\n\n".join(p.strip() for p in pages if p.strip())


def fetch_url_as_text(url: str) -> str:
    """Fetch a URL; if PDF, extract; if HTML, readability-extract main content."""
    import re

    import httpx
    from readability import Document

    with httpx.Client(timeout=25.0, follow_redirects=True, headers={"User-Agent": "hacknation-scientist/0.1"}) as c:
        r = c.get(url)
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        if "pdf" in ctype or url.lower().endswith(".pdf"):
            return extract_pdf_text(r.content)
        doc = Document(r.text)
        html = doc.summary(html_partial=True)
        text = re.sub(r"<[^>]+>", " ", html)
        return re.sub(r"\s+", " ", text).strip()
