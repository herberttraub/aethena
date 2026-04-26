"""Provider-agnostic LLM + embedding interface.

Default provider is Gemini. Set LLM_PROVIDER=openai in .env to swap.
All app code calls `generate_text`, `generate_structured`, `embed`.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from .settings import settings


# ─── Gemini ────────────────────────────────────────────────────────────────
def _gemini_client():
    from google import genai

    return genai.Client(api_key=settings.GEMINI_KEY)


def _gemini_generate_text(prompt: str, system: str | None = None, model: str | None = None) -> str:
    from google.genai import types as gtypes

    client = _gemini_client()
    resp = client.models.generate_content(
        model=model or settings.GEMINI_MODEL_FLASH,
        contents=prompt,
        config=gtypes.GenerateContentConfig(
            system_instruction=system,
            temperature=0.3,
        ),
    )
    return (resp.text or "").strip()


def _gemini_generate_structured(
    prompt: str,
    response_schema: type | dict,
    system: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    from google.genai import types as gtypes

    client = _gemini_client()
    resp = client.models.generate_content(
        model=model or settings.GEMINI_MODEL_PRO,
        contents=prompt,
        config=gtypes.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=response_schema,
            max_output_tokens=32768,
        ),
    )
    text = (resp.text or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini structured output was not valid JSON: ...{text[-400:]}") from e


def _gemini_embed(texts: list[str]) -> list[list[float]]:
    """Batched Matryoshka-truncated embeddings at GEMINI_EMBEDDING_DIM."""
    from google.genai import types as gtypes

    client = _gemini_client()
    out: list[list[float]] = []
    BATCH = 50
    for i in range(0, len(texts), BATCH):
        batch = texts[i : i + BATCH]
        resp = client.models.embed_content(
            model=settings.GEMINI_EMBEDDING_MODEL,
            contents=batch,
            config=gtypes.EmbedContentConfig(
                output_dimensionality=settings.GEMINI_EMBEDDING_DIM,
            ),
        )
        for e in resp.embeddings or []:
            out.append(list(e.values or []))
    return out


# ─── OpenAI (parked, ready to swap) ────────────────────────────────────────
def _openai_client():
    from openai import OpenAI

    return OpenAI(api_key=settings.OPENAI_KEY)


def _openai_generate_text(prompt: str, system: str | None = None, model: str | None = None) -> str:
    client = _openai_client()
    resp = client.responses.create(
        model=model or settings.OPENAI_MODEL_FLASH,
        instructions=system or "",
        input=prompt,
    )
    return (resp.output_text or "").strip()


def _openai_generate_structured(
    prompt: str,
    response_schema: type | dict,
    system: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    client = _openai_client()
    schema = response_schema
    if isinstance(response_schema, type):
        schema = response_schema.model_json_schema()
    schema_prompt = (
        f"{prompt}\n\nReturn JSON only. It must conform to this JSON schema:\n"
        f"{json.dumps(schema)[:12000]}"
    )
    resp = client.chat.completions.create(
        model=model or settings.OPENAI_MODEL_PRO,
        messages=[
            {"role": "system", "content": system or "Return JSON only."},
            {"role": "user", "content": schema_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    text = resp.choices[0].message.content or "{}"
    return json.loads(text)


def _openai_embed(texts: list[str]) -> list[list[float]]:
    client = _openai_client()
    resp = client.embeddings.create(model=settings.OPENAI_EMBEDDING_MODEL, input=texts)
    return [d.embedding for d in resp.data]


# ─── Public API ────────────────────────────────────────────────────────────
def generate_text(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    provider: Literal["gemini", "openai"] | None = None,
) -> str:
    active_provider = provider or settings.LLM_PROVIDER
    if active_provider == "gemini":
        return _gemini_generate_text(prompt, system=system, model=model)
    return _openai_generate_text(prompt, system=system, model=model)


def generate_structured(
    prompt: str,
    response_schema: type | dict,
    *,
    system: str | None = None,
    model: str | None = None,
    provider: Literal["gemini", "openai"] | None = None,
) -> dict[str, Any]:
    active_provider = provider or settings.LLM_PROVIDER
    if active_provider == "gemini":
        return _gemini_generate_structured(prompt, response_schema, system=system, model=model)
    return _openai_generate_structured(prompt, response_schema, system=system, model=model)


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if settings.LLM_PROVIDER == "gemini":
        return _gemini_embed(texts)
    return _openai_embed(texts)
