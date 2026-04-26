"""Naive whitespace chunker. Good enough for abstracts + protocol pages."""
from __future__ import annotations


def chunk_text(text: str, target_words: int = 450, overlap_words: int = 60) -> list[str]:
    words = text.split()
    if len(words) <= target_words:
        return [" ".join(words).strip()] if words else []
    chunks: list[str] = []
    step = max(1, target_words - overlap_words)
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + target_words]).strip()
        if chunk:
            chunks.append(chunk)
        i += step
    return chunks
