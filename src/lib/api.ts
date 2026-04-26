/**
 * Vite-side API client + adapter layer.
 *
 * The FastAPI backend (api/) speaks "Repo B" data shapes. The Lovable UI
 * (the rest of /src) reads "Repo A" data shapes. This module:
 *   1. wraps fetch calls to FastAPI
 *   2. translates request/response shapes so the existing UI components
 *      do not need to change
 *   3. preserves the exact contracts that Supabase functions used to
 *      provide (literatureQc, generatePlan, submitReview, …) so swapping
 *      `supabase.functions.invoke('x', …)` for `api.x(…)` is a one-line edit
 *
 * Single source of truth for *types* the UI consumes is still
 * `src/lib/scientist-types.ts` (Lovable shapes). This file imports those
 * types and produces values that match them.
 */
import type {
  Collaborator,
  Depth,
  EquipmentSourcing,
  ExperimentPlan,
  Material,
  Novelty,
  ProtocolStep,
  QcResult,
  Reference,
  TimelinePhase,
} from "./scientist-types";

import { API_BASE as BASE } from "./api-base";
import { auth } from "./auth";

function authHeaders(): Record<string, string> {
  const t = auth.token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function jdelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function jform<T>(path: string, fd: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: fd, headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Default team — matches the backend seed in api/db/init.sql; used until the user logs in.
const DEFAULT_TEAM_ID = "00000000-0000-0000-0000-000000000001";

function currentTeamId(): string {
  return auth.current()?.team_id || DEFAULT_TEAM_ID;
}

// ─── Repo B raw shapes (from api/schemas/*.py) ────────────────────────────
interface BReference {
  title: string;
  authors: string;
  year: number | null;
  source: string;
  source_id: string;
  url: string;
  similarity: number;
  snippet: string;
}
interface BQCResult {
  status:
    | "not_found"
    | "similar_work_exists"
    | "exact_match_found"
    | "no_indexed_knowledge"
    | "ungrounded";
  novelty_score: number;
  rationale: string;
  references: BReference[];
  needs_user_choice: boolean;
  fallback_options: string[];
  is_ungrounded: boolean;
}

interface BProtocolStep {
  id: string;
  name: string;
  duration_minutes: number;
  rationale: string;
  materials_used: string[];
  equipment_used: string[];
  qc_checks: string[];
  assumed_skills: string[];
  can_run_parallel_with: string[];
  notes: string;
}

interface BMaterial {
  name: string;
  catalog_no: string;
  supplier: string;
  supplier_url: string;
  unit_size: string;
  qty: number;
  unit_cost_usd: number;
  total_cost_usd: number;
  lead_time_days: number | null;
  shelf_life_days: number | null;
  storage: string;
  order_priority: "early" | "middle" | "late";
}

interface BBudgetCategory {
  name: "consumables" | "equipment" | "labor" | "contingency" | "other";
  total_usd: number;
}

interface BPhase {
  name: string;
  week_start: number;
  week_end: number;
  deliverables: string[];
  dependencies: string[];
  parallel_with: string[];
}

interface BExperimentPlan {
  title: string;
  hypothesis: string;
  novelty_summary: string;
  scale_hint: "small" | "medium" | "large";
  environmental_conditions: {
    temp_min_C: number;
    temp_max_C: number;
    humidity_min_pct: number | null;
    humidity_max_pct: number | null;
    light: string;
    atmosphere: string;
    season_sensitivity: string;
  };
  protocol: BProtocolStep[];
  materials: BMaterial[];
  equipment: { name: string; model: string; location: string; owner_team: string }[];
  budget: {
    line_items: BMaterial[];
    categories: BBudgetCategory[];
    total_usd: number;
    currency: string;
    contingency_pct: number;
  };
  timeline: BPhase[];
  staffing: {
    role: string;
    fte_pct: number;
    named_person: string;
    institution: string;
    expertise_tags: string[];
  }[];
  validation: {
    success_criteria: string[];
    failure_modes: string[];
    statistics_plan: string;
  };
  references: {
    title: string;
    authors: string;
    year: number | null;
    doi: string;
    url: string;
    relevance: string;
  }[];
  open_questions: string[];
  budget_justification: string;
}

// ─── Adapters: B → Lovable ────────────────────────────────────────────────
const NOVELTY_MAP: Record<BQCResult["status"], Novelty> = {
  not_found: "not_found",
  similar_work_exists: "similar_work_exists",
  exact_match_found: "exact_match_found",
  no_indexed_knowledge: "not_found",
  ungrounded: "not_found",
};

function adaptReference(r: BReference): Reference {
  const url = r.url || (r.source_id?.startsWith("http") ? r.source_id : "") ||
    (r.source_id ? `https://doi.org/${r.source_id}` : "");
  const authors = r.authors
    ? r.authors.split(",").map((a) => a.trim()).filter(Boolean)
    : undefined;
  return {
    title: r.title,
    year: r.year,
    authors,
    venue: r.source || undefined,
    url: url || undefined,
    abstract: r.snippet || undefined,
  };
}

function adaptQc(b: BQCResult): QcResult {
  return {
    novelty: NOVELTY_MAP[b.status] ?? "not_found",
    rationale: b.rationale,
    references: (b.references || []).map(adaptReference),
    searched: (b.references || []).length,
  };
}

function adaptProtocolStep(s: BProtocolStep, idx: number): ProtocolStep {
  // Keep rationale + notes as the prose body. assumed_skills and qc_checks
  // surface as their own arrays so the UI can render them distinctly.
  const description = [s.rationale, s.notes].filter(Boolean).join("\n\n");
  return {
    step: idx + 1,
    title: s.name,
    description,
    duration: `${s.duration_minutes} min`,
    equipment: [...new Set(s.equipment_used || [])],
    materials: [...new Set(s.materials_used || [])],
    assumed_skills: [...new Set(s.assumed_skills || [])],
    qc_checks: [...new Set(s.qc_checks || [])],
    safety_notes: "", // safety lives in plan-level safety field, not per-step
  };
}

function adaptMaterial(m: BMaterial): Material {
  const qty = m.unit_size ? `${m.qty} × ${m.unit_size}` : String(m.qty || "");
  const noteParts: string[] = [];
  if (m.shelf_life_days) noteParts.push(`shelf life ${m.shelf_life_days} d`);
  if (m.storage) noteParts.push(`store ${m.storage}`);
  if (m.lead_time_days != null) noteParts.push(`lead time ${m.lead_time_days} d`);
  if (m.order_priority) noteParts.push(`order ${m.order_priority}`);
  return {
    name: m.name,
    catalog_number: m.catalog_no || "",
    supplier: m.supplier || "",
    quantity: qty,
    unit_cost_usd: m.unit_cost_usd || 0,
    link: googleLuckyUrl(m),
    notes: noteParts.join(" · "),
  };
}

/** Build a Google "I'm Feeling Lucky" search URL so material links always
 * resolve to a relevant page even when the LLM hallucinates a catalog URL.
 * btnI=I bypasses the SERP and redirects to the top result. */
function googleLuckyUrl(m: BMaterial): string {
  const parts = [m.supplier, m.name, m.catalog_no].filter(Boolean);
  const q = parts.join(" ").trim();
  if (!q) return "";
  return `https://www.google.com/search?q=${encodeURIComponent(q)}&btnI=I`;
}

function categoryFor(m: BMaterial): string {
  const text = `${m.name} ${m.supplier} ${m.catalog_no}`.toLowerCase();
  if (/(reader|detector|instrument|pipette|incubator|centrifuge|oven|freeze|freezer|chamber|microscope|cytometer|spectrometer)/.test(text)) {
    return "Equipment";
  }
  if (/(service|labor|technician|consult)/.test(text)) return "Labor";
  return "Consumables";
}

function adaptBudgetLines(plan: BExperimentPlan): ExperimentPlan["budget"] {
  // Lovable's BudgetLine is per-item. Map each material to one line; append a
  // contingency line if Repo B's budget has one.
  const lines = (plan.materials || []).map((m) => ({
    category: categoryFor(m),
    item: m.name,
    amount_usd: m.total_cost_usd || (m.qty * m.unit_cost_usd) || 0,
    notes: m.supplier ? `${m.supplier}${m.catalog_no ? " · " + m.catalog_no : ""}` : "",
  }));
  const cats = plan.budget?.categories || [];
  const contingency = cats.find((c) => c.name === "contingency")?.total_usd ?? 0;
  if (contingency > 0) {
    lines.push({
      category: "Contingency",
      item: "Contingency reserve",
      amount_usd: contingency,
      notes: plan.budget?.contingency_pct ? `${plan.budget.contingency_pct}% of subtotal` : "",
    });
  }
  return lines;
}

function adaptTimeline(phases: BPhase[]): TimelinePhase[] {
  return (phases || []).map((p) => ({
    phase: p.name,
    start_week: p.week_start,
    end_week: p.week_end,
    deliverable: (p.deliverables || []).join("; "),
    depends_on: p.dependencies || [],
  }));
}

function adaptPlan(b: BExperimentPlan, hypothesis: string): ExperimentPlan {
  const successCriteria = (b.validation?.success_criteria || []).join("; ");
  const failureModes = b.validation?.failure_modes || [];

  return {
    domain: b.scale_hint || "general",
    overview: {
      restated_hypothesis: hypothesis || b.hypothesis || "",
      objective: b.title || b.novelty_summary?.split(".")[0] + "." || "",
      control_condition: failureModes[0] || "Standard reference protocol used as comparator.",
      success_criteria: successCriteria || b.validation?.statistics_plan || "",
    },
    protocol: (b.protocol || []).map(adaptProtocolStep),
    materials: (b.materials || []).map(adaptMaterial),
    budget: adaptBudgetLines(b),
    timeline: adaptTimeline(b.timeline),
    validation: {
      primary_endpoint: (b.validation?.success_criteria || [])[0] || "",
      statistical_approach: b.validation?.statistics_plan || "",
      decision_criteria: successCriteria,
      risks: failureModes,
    },
    equipment_list: (b.equipment || []).map((e) => ({
      name: e.name,
      model: e.model,
      location: e.location,
      owner_team: e.owner_team,
    })),
  };
}

// Equipment as a string list (used by sourceEquipment input)
export function equipmentNamesFromPlan(plan: BExperimentPlan): string[] {
  return (plan.equipment || []).map((e) => e.name).filter(Boolean);
}

// ─── Public surface — drop-in replacements for Supabase functions ─────────
export const api = {
  health: () => jget<{ status: string; provider: string; demo_mode: string }>("/health"),

  /** parse-uploads → { summary } */
  async parseUploads(files: File[]): Promise<{ summary: string }> {
    if (files.length === 0) return { summary: "" };
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    return jform<{ summary: string }>("/parse-uploads", fd);
  },

  /** literature-qc → QcResult (Lovable shape) */
  async literatureQc({
    hypothesis,
    upload_summary,
  }: { hypothesis: string; upload_summary?: string }): Promise<QcResult> {
    if (upload_summary && upload_summary.trim()) {
      const fd = new FormData();
      fd.append("question", hypothesis);
      fd.append("source_text", upload_summary);
      const raw = await jform<BQCResult>("/qc/with-source", fd);
      return adaptQc(raw);
    }
    const raw = await jpost<BQCResult>("/qc", {
      question: hypothesis,
      team_id: currentTeamId(),
    });
    return adaptQc(raw);
  },

  /** generate-plan → { id, plan, feedback_applied, _raw_plan } */
  async generatePlan({
    hypothesis,
    qc,
    depth,
    upload_summary,
  }: {
    hypothesis: string;
    qc: QcResult | null;
    depth: Depth;
    upload_summary?: string;
  }): Promise<{
    id: string;
    plan: ExperimentPlan;
    feedback_applied: number;
    _raw_plan: BExperimentPlan;
  }> {
    const depthMap: Record<Depth, "brief" | "standard" | "deep"> = {
      light: "brief",
      regular: "standard",
      deep: "deep",
    };
    const body = {
      question: hypothesis,
      depth: depthMap[depth],
      team_id: currentTeamId(),
      qc_status: qc?.novelty,
      qc_rationale: qc?.rationale,
      qc_references: (qc?.references || []).map((r) => ({
        title: r.title,
        year: r.year,
        authors: (r.authors || []).join(", "),
        source_id: r.url,
      })),
    };
    const r = await jpost<{
      plan_id: string;
      query_id: string;
      plan: BExperimentPlan;
      experiment_type: string;
      domain: string;
      grounding_used: number;
      team_examples_applied: number;
    }>("/plan", body);
    return {
      id: r.plan_id,
      plan: adaptPlan(r.plan, hypothesis),
      feedback_applied: r.team_examples_applied || 0,
      _raw_plan: r.plan,
    };
  },

  /** submit-review → fan out to /feedback per item */
  async submitReview({
    plan_id,
    items,
    author: _author,
  }: {
    plan_id: string;
    author?: string;
    items: {
      section: string;
      rating?: number | null;
      correction_text?: string | null;
      original_value?: string | null;
      corrected_value?: string | null;
    }[];
  }): Promise<{ ok: true }> {
    await Promise.all(
      (items || []).map((it) =>
        jpost<{ ok: boolean; accepted: boolean; reason?: string }>("/feedback", {
          plan_id,
          team_id: currentTeamId(),
          section: it.section,
          before: it.original_value,
          after: it.corrected_value,
          freeform_note: [
            it.rating != null ? `rating: ${it.rating}/5` : "",
            it.correction_text || "",
          ].filter(Boolean).join("\n"),
        }),
      ),
    );
    return { ok: true };
  },

  /** find-collaborators → { collaborators } (Lovable shape; backend already matches) */
  findCollaborators: (body: { hypothesis: string; plan?: unknown }) =>
    jpost<{ collaborators: Collaborator[]; skills: string[] }>("/collaborators", body),

  /** source-equipment → { sourcing } */
  sourceEquipment: (body: { equipment: string[] }) =>
    jpost<{ sourcing: EquipmentSourcing[] }>("/equipment-sourcing", body),

  /** draft-outreach-email → { subject, body } */
  draftOutreachEmail: (body: {
    hypothesis: string;
    collaborator: Collaborator;
    sender_name?: string;
  }) => jpost<{ subject: string; body: string }>("/draft-outreach-email", body),

  /** Single-plan deep-link fetch */
  async getPlan(id: string): Promise<{
    id: string;
    hypothesis: string;
    plan: ExperimentPlan;
    qc_result: QcResult | null;
    domain: string | null;
    created_at: string | null;
  }> {
    const r = await jget<{
      plan_id: string;
      plan: BExperimentPlan;
      hypothesis?: string;
      domain?: string;
      created_at?: string;
    }>(`/plan/${id}`);
    const hypothesis = r.hypothesis || "";
    return {
      id: r.plan_id,
      hypothesis,
      plan: adaptPlan(r.plan, hypothesis),
      qc_result: null, // not persisted yet — UI tolerates null
      domain: r.domain || null,
      created_at: r.created_at || null,
    };
  },

  /** History — list past plans for the Reviews page */
  async listPlans(limit = 40): Promise<
    {
      id: string;
      hypothesis: string;
      domain: string | null;
      plan: ExperimentPlan | null;
      created_at: string;
      reviewCount: number;
    }[]
  > {
    const r = await jget<{
      items: {
        plan_id: string;
        question: string;
        domain: string | null;
        plan: BExperimentPlan;
        created_at?: string;
        feedback_count?: number;
      }[];
    }>(`/history?limit=${limit}`);
    return (r.items || []).map((it) => ({
      id: it.plan_id,
      hypothesis: it.question,
      domain: it.domain,
      plan: it.plan ? adaptPlan(it.plan, it.question) : null,
      created_at: it.created_at || new Date().toISOString(),
      reviewCount: it.feedback_count ?? 0,
    }));
  },

  /** Export — returns a URL the UI can fetch / window.open */
  exportUrl: (planId: string, format: "pdf" | "docx" | "tex" | "md") =>
    `${BASE}/plan/${planId}/export?format=${format}`,

  /** Profile preferences (the things the model has "learned" about this team). */
  async listPreferences(): Promise<
    {
      id: string;
      section: string;
      before: string | null;
      after: string | null;
      freeform_note: string | null;
      experiment_type: string | null;
      domain: string | null;
      created_at: string;
    }[]
  > {
    const r = await jget<{ items: any[] }>("/me/preferences");
    return r.items || [];
  },

  async deletePreference(id: string): Promise<void> {
    await jdelete(`/me/preferences/${encodeURIComponent(id)}`);
  },
};

export type { BExperimentPlan };
