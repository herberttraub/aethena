"""Email + password auth with bcrypt-hashed passwords and JWT session tokens.

The `users` table stores the credential, profile fields, and the team_id
that ties a user to their plans/feedback. The `team_id` is generated at
register time and reused as the FK target for every persisted row.

A user's profile (role, research_type, institution) is stored on the same
row and surfaced through `/auth/me`. The collaborator search reads the
institution to bias the fallback pool.
"""
from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

import bcrypt
import jwt
import psycopg
from fastapi import Depends, Header, HTTPException, status

from .settings import settings


def _conn():
    return psycopg.connect(settings.DATABASE_URL.replace("+psycopg", ""))


# ─── Password hashing ──────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─── JWT ───────────────────────────────────────────────────────────────────
def issue_token(*, user_id: str, team_id: str, email: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "team_id": str(team_id),
        "email": email,
        "iat": now,
        "exp": now + settings.JWT_TTL_DAYS * 86400,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


# ─── Schema bootstrap (idempotent) ─────────────────────────────────────────
USERS_TABLE_SQL = """
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    password_hash text not null,
    name text,
    team_id uuid references teams(id) on delete set null,
    role text,
    research_type text,
    institution text,
    onboarded boolean not null default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists users_team_id_idx on users(team_id);
"""


def ensure_users_table() -> None:
    """Run idempotent migration so the users table exists. Called at app startup."""
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(USERS_TABLE_SQL)
            # Make sure feedback.domain column exists (was missing in some
            # earlier deployments — the planner inserts that field).
            cur.execute("alter table feedback add column if not exists domain text")
            conn.commit()
    except Exception:
        # Don't crash the worker on migration error — surface via /health later.
        pass


# ─── Repository helpers ────────────────────────────────────────────────────
def _row_to_user(row: tuple) -> dict[str, Any]:
    """Materialize a users-table row into a JSON-serializable dict.
    psycopg returns uuid columns as `uuid.UUID` objects, which both
    `json.dumps` (FastAPI response) and `jwt.encode` (token payload)
    refuse to serialize — so we cast id and team_id to str at the boundary."""
    keys = ["id", "email", "password_hash", "name", "team_id", "role", "research_type", "institution", "onboarded"]
    user = dict(zip(keys, row))
    if user.get("id") is not None:
        user["id"] = str(user["id"])
    if user.get("team_id") is not None:
        user["team_id"] = str(user["team_id"])
    return user


def find_user_by_email(email: str) -> dict[str, Any] | None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, email, password_hash, name, team_id, role, research_type, institution, onboarded "
            "from users where email = %s",
            (email.lower().strip(),),
        )
        row = cur.fetchone()
        return _row_to_user(row) if row else None


def find_user_by_id(user_id: str) -> dict[str, Any] | None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, email, password_hash, name, team_id, role, research_type, institution, onboarded "
            "from users where id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        return _row_to_user(row) if row else None


def create_user(*, email: str, password: str, name: str | None) -> dict[str, Any]:
    email = email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if find_user_by_email(email):
        raise HTTPException(status_code=409, detail="An account already exists for this email.")

    user_id = str(uuid.uuid4())
    team_id = str(uuid.uuid4())
    pw_hash = hash_password(password)
    label = (name or email.split("@")[0])[:120]

    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into teams (id, name) values (%s, %s) on conflict (id) do nothing",
            (team_id, label),
        )
        cur.execute(
            "insert into users (id, email, password_hash, name, team_id) "
            "values (%s, %s, %s, %s, %s)",
            (user_id, email, pw_hash, name, team_id),
        )
        conn.commit()

    return {
        "id": user_id,
        "email": email,
        "name": name,
        "team_id": team_id,
        "role": None,
        "research_type": None,
        "institution": None,
        "onboarded": False,
    }


def update_profile(
    *,
    user_id: str,
    name: str | None,
    role: str | None,
    research_type: str | None,
    institution: str | None,
) -> dict[str, Any]:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            update users
               set name = coalesce(%s, name),
                   role = %s,
                   research_type = %s,
                   institution = %s,
                   onboarded = true,
                   updated_at = now()
             where id = %s
            """,
            (name, role, research_type, institution, user_id),
        )
        conn.commit()
    user = find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


# ─── FastAPI dependency ────────────────────────────────────────────────────
def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Bearer-token auth dependency. Returns the user dict, or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session token.")
    user = find_user_by_id(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists.")
    return user


def get_current_user_optional(authorization: str | None = Header(default=None)) -> dict[str, Any] | None:
    """Like get_current_user but returns None instead of raising when there's
    no valid token. Useful for endpoints that work for both authed and
    anonymous callers."""
    if not authorization:
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """Strip password_hash before returning a user dict over the wire."""
    return {k: v for k, v in user.items() if k != "password_hash"}
