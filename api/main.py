"""FastAPI entry point. Run with:
    .venv/Scripts/python.exe -m uvicorn api.main:app --port 8765 --reload
"""
from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import json
import uuid

import psycopg

from . import llm
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response

from .agents import collaborators as collaborators_agent
from .agents import equipment_sourcing as equipment_sourcing_agent
from .agents import exporter as exporter_agent
from .agents import outreach as outreach_agent
from .agents import parse_uploads as parse_uploads_agent
from .agents import planner as planner_agent
from .agents import qc as qc_agent
from .agents import refiner as refiner_agent
from .rag.pdf_extract import extract_pdf_text
from .schemas.plan import PlanRequest
from .schemas.qc import QCRequest, QCResult
from .settings import settings
from . import auth as auth_module
from fastapi import Depends


def _conn():
    return psycopg.connect(settings.DATABASE_URL.replace("+psycopg", ""))

app = FastAPI(title="AI Scientist", version="0.1.0")

_CORS_ORIGINS = [
    "http://localhost:8080",  # Vite default in build-your-spark-530
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://localhost:5173",  # generic Vite default
    "http://127.0.0.1:5173",
    "https://aethena.vercel.app",  # Vercel production deploy
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup() -> None:
    """Idempotent migrations: users table, feedback.domain column."""
    auth_module.ensure_users_table()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Make sure CORS headers go out on every error, otherwise the browser
    reports a misleading "CORS error" instead of the real one."""
    origin = request.headers.get("origin", "")
    headers = {
        "Access-Control-Allow-Origin": origin if origin in set(_CORS_ORIGINS) else "*",
        "Access-Control-Allow-Credentials": "true",
    }
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)[:600], "type": exc.__class__.__name__},
        headers=headers,
    )


# ─── Health ────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "provider": settings.LLM_PROVIDER,
        "demo_mode": str(settings.DEMO_MODE).lower(),
    }


class EchoIn(BaseModel):
    text: str


@app.post("/echo")
def echo(body: EchoIn) -> dict[str, str]:
    out = llm.generate_text(
        f"Say exactly this sentence back to me, with no extra words: {body.text}",
        system="You are a literal echo. Return the user's sentence verbatim.",
    )
    return {"input": body.text, "output": out}


# ─── QC ────────────────────────────────────────────────────────────────────
@app.post("/qc", response_model=QCResult)
def qc(body: QCRequest) -> QCResult:
    """Default QC: search indexed corpus. May return needs_user_choice=true
    when the corpus has nothing relevant."""
    return qc_agent.run_qc(body.question)


@app.post("/qc/with-source", response_model=QCResult)
async def qc_with_source(
    question: str = Form(...),
    source_url: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
) -> QCResult:
    """User-supplied source — URL or uploaded PDF. Retrieves against that
    source plus our corpus, then runs verdict."""
    source_text: str | None = None
    if file is not None:
        raw = await file.read()
        if file.filename and file.filename.lower().endswith(".pdf"):
            source_text = extract_pdf_text(raw)
        else:
            source_text = raw.decode("utf-8", errors="ignore")
    return qc_agent.run_qc_with_source(question, source_url=source_url, source_text=source_text)


class QCBroadIn(BaseModel):
    question: str


@app.post("/qc/broad", response_model=QCResult)
def qc_broad(body: QCBroadIn) -> QCResult:
    """No retrieval, straight LLM call. Every claim tagged [ungrounded]."""
    return qc_agent.run_qc_broad(body.question)


# ─── Plan ──────────────────────────────────────────────────────────────────
@app.post("/plan")
def plan(body: PlanRequest) -> dict:
    """Generate an ExperimentPlan, persist query + plan rows."""
    out = planner_agent.generate_plan(
        body.question,
        depth=body.depth,
        team_id=body.team_id,
        qc_status=body.qc_status,
        qc_rationale=body.qc_rationale,
        qc_references=body.qc_references,
    )

    query_id = str(uuid.uuid4())
    plan_id = str(uuid.uuid4())
    try:
        with _conn() as conn, conn.cursor() as cur:
            if body.team_id:
                cur.execute(
                    "insert into teams (id, name) values (%s, %s) on conflict (id) do nothing",
                    (body.team_id, "Lab"),
                )
            cur.execute(
                "insert into queries (id, team_id, question, experiment_type, domain) values (%s, %s, %s, %s, %s)",
                (query_id, body.team_id, body.question, out["experiment_type"], out["domain"]),
            )
            cur.execute(
                "insert into plans (id, query_id, team_id, depth_mode, plan) values (%s, %s, %s, %s, %s::jsonb)",
                (plan_id, query_id, body.team_id, body.depth, json.dumps(out["plan"])),
            )
            conn.commit()
    except Exception as e:
        # don't block plan return on persistence
        out["persistence_error"] = str(e)

    return {
        "plan_id": plan_id,
        "query_id": query_id,
        **out,
    }


@app.get("/history")
def history(limit: int = 3) -> dict:
    """Return the most recent persisted generated reports."""
    bounded = max(1, min(limit, 50))
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select
                    p.id,
                    p.query_id,
                    q.question,
                    p.depth_mode,
                    p.plan,
                    q.experiment_type,
                    q.domain,
                    p.created_at
                from plans p
                join queries q on q.id = p.query_id
                order by p.created_at desc
                limit %s
                """,
                (bounded,),
            )
            rows = cur.fetchall()
    except Exception as e:
        return {"items": [], "error": str(e)}

    items = []
    for row in rows:
        plan_json = row[4]
        items.append(
            {
                "plan_id": str(row[0]),
                "query_id": str(row[1]),
                "question": row[2],
                "depth": row[3],
                "plan": plan_json,
                "experiment_type": row[5] or "unknown",
                "domain": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
                "grounding_used": len((plan_json or {}).get("references") or []),
                "team_examples_applied": 0,
            }
        )
    return {"items": items}


# ─── Feedback (self-learning) ──────────────────────────────────────────────
class FeedbackIn(BaseModel):
    plan_id: str
    team_id: str | None = None
    section: str
    before: str | None = None
    after: str | None = None
    freeform_note: str | None = None


@app.post("/feedback")
def feedback(body: FeedbackIn) -> dict:
    row = refiner_agent.fetch_plan_row(body.plan_id)
    if not row:
        return {"ok": False, "accepted": False, "reason": "plan not found"}

    review = refiner_agent.review_feedback(
        plan=row["plan"],
        section=body.section,
        before=body.before,
        after=body.after,
        freeform_note=body.freeform_note,
    )
    refiner_agent.store_feedback(
        plan_id=body.plan_id,
        team_id=body.team_id or row["team_id"],
        experiment_type=row.get("experiment_type"),
        domain=row.get("domain"),
        section=body.section,
        before=body.before,
        after=body.after,
        freeform_note=body.freeform_note,
        accepted=review["accepted"],
        reason=review["reason"],
    )
    return {"ok": True, "accepted": review["accepted"], "reason": review["reason"]}


class RefineIn(BaseModel):
    plan_id: str
    section: str
    instruction: str  # more_detail | less_detail | freeform
    freeform_note: str | None = None


@app.post("/refine")
def refine(body: RefineIn) -> dict:
    row = refiner_agent.fetch_plan_row(body.plan_id)
    if not row:
        return {"section": body.section, "updated_text": "", "error": "plan not found"}
    text = refiner_agent.refine_section(
        plan=row["plan"],
        section=body.section,
        instruction=body.instruction,
        freeform_note=body.freeform_note,
    )
    return {"section": body.section, "updated_text": text}


# ─── Single plan fetch (for ?plan=<id> deep-linking) ───────────────────────
@app.get("/plan/{plan_id}")
def get_plan(plan_id: str) -> dict:
    from .agents import supplier_links

    row = refiner_agent.fetch_plan_row(plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="plan not found")
    # Canonicalize supplier URLs in case this plan was persisted before we
    # started cleaning hallucinated links.
    plan_dict = row["plan"]
    if isinstance(plan_dict, dict):
        plan_dict["materials"] = supplier_links.canonicalize_materials(plan_dict.get("materials") or [])
        if isinstance(plan_dict.get("budget"), dict):
            plan_dict["budget"]["line_items"] = supplier_links.canonicalize_materials(
                plan_dict["budget"].get("line_items") or []
            )
    # Pull back the question + qc context too if available
    extra: dict = {}
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select q.question, q.experiment_type, q.domain, p.depth_mode, p.created_at
                from plans p
                left join queries q on q.id = p.query_id
                where p.id = %s
                """,
                (plan_id,),
            )
            r = cur.fetchone()
            if r:
                extra = {
                    "hypothesis": r[0],
                    "experiment_type": r[1],
                    "domain": r[2],
                    "depth_mode": r[3],
                    "created_at": r[4].isoformat() if r[4] else None,
                }
    except Exception:
        pass
    return {"plan_id": plan_id, "team_id": row.get("team_id"), "plan": plan_dict, **extra}


# ─── Export ────────────────────────────────────────────────────────────────
@app.get("/plan/{plan_id}/export")
def export_plan(plan_id: str, format: str = "pdf") -> Response:
    row = refiner_agent.fetch_plan_row(plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="plan not found")
    md = exporter_agent.plan_to_markdown(row["plan"])
    fmt = format.lower()
    safe_title = (row["plan"].get("title") or "experiment-plan").replace(" ", "_")[:60]

    if fmt == "md":
        return Response(
            content=md,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.md"'},
        )
    if fmt == "pdf":
        pdf = exporter_agent.render_pdf(md)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
        )
    if fmt == "docx":
        data = exporter_agent.render_docx(md)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
        )
    if fmt == "tex":
        tex = exporter_agent.render_latex(md)
        return Response(
            content=tex,
            media_type="application/x-tex",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.tex"'},
        )
    raise HTTPException(status_code=400, detail=f"unknown format: {format}")


# ─── Collaborators (Lovable port) ──────────────────────────────────────────
class CollaboratorsIn(BaseModel):
    hypothesis: str
    plan: dict | None = None


@app.post("/collaborators")
def collaborators(
    body: CollaboratorsIn,
    user: dict | None = Depends(auth_module.get_current_user_optional),
) -> dict:
    if not body.hypothesis or not body.hypothesis.strip():
        raise HTTPException(status_code=400, detail="hypothesis is required")
    institution = (user or {}).get("institution") or None
    return collaborators_agent.find_collaborators(body.hypothesis, body.plan, institution=institution)


# ─── Equipment sourcing (Lovable port) ─────────────────────────────────────
class EquipmentSourcingIn(BaseModel):
    equipment: list[str]


@app.post("/equipment-sourcing")
def equipment_sourcing(body: EquipmentSourcingIn) -> dict:
    return equipment_sourcing_agent.source_equipment(body.equipment or [])


# ─── Outreach email draft (Lovable port) ───────────────────────────────────
class OutreachIn(BaseModel):
    hypothesis: str
    collaborator: dict
    sender_name: str | None = None


@app.post("/draft-outreach-email")
def draft_outreach_email(body: OutreachIn) -> dict:
    return outreach_agent.draft(body.hypothesis, body.collaborator, body.sender_name)


# ─── Parse uploads (Lovable port) ──────────────────────────────────────────
@app.post("/parse-uploads")
async def parse_uploads(files: list[UploadFile] = File(default=[])) -> dict:
    if not files:
        return {"summary": ""}
    items: list[tuple[str, str, bytes]] = []
    for f in files:
        raw = await f.read()
        items.append((f.filename or "upload", f.content_type or "", raw))
    return {"summary": parse_uploads_agent.parse_files(items)}


# ─── Auth ──────────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileIn(BaseModel):
    name: str | None = None
    role: str | None = None
    research_type: str | None = None
    institution: str | None = None


@app.post("/auth/register")
def auth_register(body: RegisterIn) -> dict:
    user = auth_module.create_user(email=body.email, password=body.password, name=body.name)
    token = auth_module.issue_token(user_id=user["id"], team_id=user["team_id"], email=user["email"])
    return {"token": token, "user": auth_module.public_user(user)}


@app.post("/auth/login")
def auth_login(body: LoginIn) -> dict:
    user = auth_module.find_user_by_email(body.email)
    if not user or not auth_module.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    token = auth_module.issue_token(user_id=user["id"], team_id=user["team_id"], email=user["email"])
    return {"token": token, "user": auth_module.public_user(user)}


@app.get("/auth/me")
def auth_me(user: dict = Depends(auth_module.get_current_user)) -> dict:
    return {"user": auth_module.public_user(user)}


@app.put("/auth/profile")
def auth_profile(body: ProfileIn, user: dict = Depends(auth_module.get_current_user)) -> dict:
    updated = auth_module.update_profile(
        user_id=user["id"],
        name=body.name,
        role=body.role,
        research_type=body.research_type,
        institution=body.institution,
    )
    return {"user": auth_module.public_user(updated)}


# ─── Preferences (what the model has learned) ──────────────────────────────
@app.get("/me/preferences")
def list_preferences(user: dict = Depends(auth_module.get_current_user)) -> dict:
    """List the team's accepted feedback rows so the user can review what
    has been folded into future plan generations."""
    rows: list[dict] = []
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select id, section, before, after, freeform_note, experiment_type,
                   domain, created_at
              from feedback
             where team_id = %s and accepted = true
             order by created_at desc
             limit 200
            """,
            (user["team_id"],),
        )
        for fid, section, before, after, note, exp_type, domain, created_at in cur.fetchall():
            rows.append({
                "id": str(fid),
                "section": section,
                "before": before,
                "after": after,
                "freeform_note": note,
                "experiment_type": exp_type,
                "domain": domain,
                "created_at": created_at.isoformat() if created_at else "",
            })
    return {"items": rows}


@app.delete("/me/preferences/{pref_id}")
def delete_preference(pref_id: str, user: dict = Depends(auth_module.get_current_user)) -> dict:
    """Soft-delete: flip accepted=false so few-shot retrieval skips this row.
    Preserves history and is reversible if the user changes their mind."""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "update feedback set accepted = false where id = %s and team_id = %s",
            (pref_id, user["team_id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Preference not found.")
        conn.commit()
    return {"ok": True, "id": pref_id}
