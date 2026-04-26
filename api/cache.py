"""Tiny local JSON response cache for expensive API-backed calls."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def key(namespace: str, payload: Any) -> str:
    digest = hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()
    return f"{namespace}_{digest}"


def get(cache_key: str) -> dict[str, Any] | None:
    path = CACHE_DIR / f"{cache_key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def set(cache_key: str, value: dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{cache_key}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=True, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)
