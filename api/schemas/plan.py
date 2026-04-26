"""ExperimentPlan schema. All 10 interview-driven rules are encoded here.

Tuples flattened to scalar fields (min/max) for Gemini structured-output friendliness.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ─── Protocol ──────────────────────────────────────────────────────────────
class ProtocolStep(BaseModel):
    id: str = Field(description="short stable id like 'S1', 'S2'")
    name: str
    duration_minutes: int
    rationale: str = Field(description="WHY this step exists — Rule 1, the #1 trust signal")
    materials_used: list[str] = Field(default_factory=list, description="material names referenced from the materials list")
    equipment_used: list[str] = Field(default_factory=list)
    qc_checks: list[str] = Field(default_factory=list)
    assumed_skills: list[str] = Field(default_factory=list, description="Rule 5 — skills the operator must already have")
    can_run_parallel_with: list[str] = Field(default_factory=list, description="Rule 6 — step ids this can overlap with")
    notes: str = ""


# ─── Materials ─────────────────────────────────────────────────────────────
class Material(BaseModel):
    name: str
    catalog_no: str = Field(default="", description="Rule 9 — required where possible")
    supplier: str = ""
    supplier_url: str = ""
    unit_size: str = ""
    qty: float = 0.0
    unit_cost_usd: float = 0.0
    total_cost_usd: float = 0.0
    lead_time_days: int | None = None
    shelf_life_days: int | None = Field(default=None, description="Rule 3")
    storage: str = ""
    order_priority: Literal["early", "middle", "late"] = "middle"


# ─── Equipment ─────────────────────────────────────────────────────────────
class Equipment(BaseModel):
    name: str
    model: str = ""
    location: str = Field(default="", description="building / room / lab — drawn from fixtures")
    owner_team: str = ""


# ─── Environmental conditions (Rule 2) ─────────────────────────────────────
class EnvironmentalConditions(BaseModel):
    temp_min_C: float
    temp_max_C: float
    humidity_min_pct: float | None = None
    humidity_max_pct: float | None = None
    light: str = ""
    atmosphere: str = Field(default="", description="e.g., 'ambient air', 'N2', 'CO2 5% incubator'")
    season_sensitivity: str = ""


# ─── Budget ────────────────────────────────────────────────────────────────
class BudgetCategory(BaseModel):
    name: Literal["consumables", "equipment", "labor", "contingency", "other"]
    total_usd: float


class Budget(BaseModel):
    line_items: list[Material] = Field(default_factory=list, description="echoes the materials list with totals; planner may collapse")
    categories: list[BudgetCategory] = Field(default_factory=list)
    total_usd: float
    currency: str = "USD"
    contingency_pct: float = 10.0


# ─── Timeline ──────────────────────────────────────────────────────────────
class Phase(BaseModel):
    name: str
    week_start: int
    week_end: int
    deliverables: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list, description="phase names this depends on")
    parallel_with: list[str] = Field(default_factory=list, description="phase names that can run alongside this")


# ─── Staffing ──────────────────────────────────────────────────────────────
class StaffAssignment(BaseModel):
    role: str
    fte_pct: int
    named_person: str = Field(default="", description="from fixtures — never invent")
    institution: str = ""
    expertise_tags: list[str] = Field(default_factory=list)


# ─── Validation ────────────────────────────────────────────────────────────
class ValidationPlan(BaseModel):
    success_criteria: list[str]
    failure_modes: list[str] = Field(default_factory=list)
    statistics_plan: str = ""


# ─── References ────────────────────────────────────────────────────────────
class PlanReference(BaseModel):
    title: str
    authors: str = ""
    year: int | None = None
    doi: str = ""
    url: str = ""
    relevance: str = ""


# ─── Top-level plan ────────────────────────────────────────────────────────
class ExperimentPlan(BaseModel):
    title: str
    hypothesis: str
    novelty_summary: str = Field(description="one paragraph — what's known, what's new")
    scale_hint: Literal["small", "medium", "large"] = "medium"

    environmental_conditions: EnvironmentalConditions

    protocol: list[ProtocolStep]
    materials: list[Material]
    equipment: list[Equipment]
    budget: Budget
    timeline: list[Phase]
    staffing: list[StaffAssignment]
    validation: ValidationPlan
    references: list[PlanReference] = Field(default_factory=list)

    open_questions: list[str] = Field(default_factory=list, description="things that genuinely need scientist judgment")
    budget_justification: str = Field(default="", description="Rule 10 — required if total exceeds scale anchor")


# ─── Request schemas ───────────────────────────────────────────────────────
class PlanRequest(BaseModel):
    question: str
    depth: Literal["brief", "standard", "deep"] = "standard"
    team_id: Optional[str] = "00000000-0000-0000-0000-000000000001"
    qc_status: str = ""
    qc_rationale: str = ""
    qc_references: list[dict] = Field(default_factory=list)
