"""draft-outreach-email — port of Lovable's email drafter.

Returns `{subject: str, body: str}`. Used by the Connect with / Collaborators panel.
"""
from __future__ import annotations

from textwrap import dedent
from typing import Any

from .. import llm
from ..settings import settings


SYSTEM_TEMPLATE = dedent(
    """
    You draft short, formal outreach emails from one academic researcher to another.

    Rules:
    - Tone: polite, formal, concise — typical of academic correspondence.
    - Salutation: "Dear Dr. <Last Name>," (use family name only).
    - 3 short paragraphs, <= 180 words total:
      1. One sentence introducing the sender and how you came across the recipient's work
         (cite the SPECIFIC matched skill or paper provided).
      2. Two-three sentences describing the hypothesis you are working on and the specific
         reason their expertise is relevant.
      3. A modest, specific ask (e.g. "a brief 20-minute call", "your perspective on
         protocol X", "advice on reagent choice"). Make clear no commitment is implied.
    - Sign off: "With kind regards,\n{sender}"
    - No emojis. No marketing language. No bullet points. No subject line in the body.
    - Return STRICT JSON: {"subject": string, "body": string}.
    """
).strip()


SCHEMA = {
    "type": "object",
    "properties": {
        "subject": {"type": "string"},
        "body": {"type": "string"},
    },
    "required": ["subject", "body"],
}


def _last_name(full_name: str) -> str:
    parts = (full_name or "").replace(",", "").split()
    parts = [p for p in parts if p and p.lower() not in {"dr.", "dr", "prof.", "prof", "professor"}]
    return parts[-1] if parts else (full_name or "Researcher")


def _fallback_email(hypothesis: str, collaborator: dict[str, Any], sender: str) -> dict[str, Any]:
    """Deterministic, LLM-free email so the UI is never empty."""
    name = _last_name(str(collaborator.get("name") or ""))
    skills = collaborator.get("matched_skills") or []
    skill_phrase = (
        f"your work on {skills[0]}" if skills else "your published work"
    )
    paper = collaborator.get("top_paper_title")
    paper_phrase = f' — particularly "{paper}"' if paper else ""

    body = (
        f"Dear Dr. {name},\n\n"
        f"My name is {sender}, and I came across {skill_phrase}{paper_phrase}. "
        f"I'm scoping an experiment around the following hypothesis:\n\n"
        f"\"{hypothesis.strip()}\"\n\n"
        f"Given your expertise, I'd value your perspective on the protocol design. "
        f"Could I impose on you for a brief 20-minute call sometime this week or next? "
        f"There's no commitment beyond that — just a sanity check from someone who has actually run related work.\n\n"
        f"With kind regards,\n{sender}"
    )
    return {"subject": f"Quick advice request — {skills[0] if skills else 'protocol design'}", "body": body}


def draft(hypothesis: str, collaborator: dict[str, Any], sender_name: str | None) -> dict[str, Any]:
    if not hypothesis or not collaborator.get("name"):
        raise ValueError("hypothesis and collaborator.name are required")

    sender = (sender_name or "").strip() or "[Your name]"
    system = SYSTEM_TEMPLATE.replace("{sender}", sender)

    matched = ", ".join(collaborator.get("matched_skills") or []) or "general topic match"
    paper_line = ""
    if collaborator.get("top_paper_title"):
        year = collaborator.get("top_paper_year")
        paper_line = f"One of their papers: \"{collaborator['top_paper_title']}\""
        if year:
            paper_line += f" ({year})"

    user_msg = dedent(
        f"""
        Recipient: {collaborator.get('name')}
        Affiliation: {collaborator.get('affiliation') or 'unknown'}
        Matched skills: {matched}
        Why relevant: {collaborator.get('relevance') or ''}
        {paper_line}

        Hypothesis the sender is working on:
        {hypothesis}
        """
    ).strip()

    try:
        out = llm.generate_structured(
            user_msg,
            response_schema=SCHEMA,
            system=system,
            model=settings.GEMINI_MODEL_FLASH,
        )
        subject = (out or {}).get("subject", "")
        body = (out or {}).get("body", "")
        if subject and body:
            return {"subject": subject, "body": body}
    except Exception:
        pass

    return _fallback_email(hypothesis, collaborator, sender)
