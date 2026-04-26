from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Reference(BaseModel):
    title: str
    authors: str = ""
    year: int | None = None
    source: str = ""
    source_id: str = ""
    url: str = ""
    similarity: float = 0.0
    snippet: str = ""


QCStatus = Literal[
    "not_found",
    "similar_work_exists",
    "exact_match_found",
    "no_indexed_knowledge",
    "ungrounded",
]


class QCResult(BaseModel):
    status: QCStatus
    novelty_score: float = Field(ge=0.0, le=1.0, description="1=fully novel, 0=exact match")
    rationale: str = ""
    references: list[Reference] = []
    needs_user_choice: bool = False
    fallback_options: list[str] = []  # e.g. ["provide_source", "broad_general_search"]
    is_ungrounded: bool = False  # true when /qc/broad path was taken


class QCRequest(BaseModel):
    question: str
    team_id: str | None = None


class QCWithSourceRequest(BaseModel):
    question: str
    source_url: str | None = None
    source_text: str | None = None  # for inline-pasted text
    team_id: str | None = None
