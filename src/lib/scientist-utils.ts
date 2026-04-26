import type { Novelty } from "./scientist-types";

export const noveltyMeta: Record<Novelty, { label: string; tone: "novel" | "similar" | "exact"; description: string }> = {
  not_found: {
    label: "Novel territory",
    tone: "novel",
    description: "No close prior work surfaced — your hypothesis appears to break new ground.",
  },
  similar_work_exists: {
    label: "Similar work exists",
    tone: "similar",
    description: "Related studies were found. Your work would build on or extend them.",
  },
  exact_match_found: {
    label: "Exact match found",
    tone: "exact",
    description: "This experiment, or one very close to it, has already been published.",
  },
};

export function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function formatTimelineWeeks(start: number, end: number): string {
  if (start === end) return `Week ${start}`;
  const span = end - start + 1;
  return `Week ${start} → ${end} · ${span} wks`;
}

export function isMeaningfulSafetyNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const t = note.trim().toLowerCase();
  if (t.length < 3) return false;
  if (["none", "n/a", "na", "no special precautions", "no special safety", "—", "-", "none required"].includes(t)) return false;
  if (t.startsWith("none")) return false;
  return true;
}

export function planToMarkdown(plan: import("./scientist-types").ExperimentPlan, hypothesis: string): string {
  const lines: string[] = [];
  lines.push(`# Experiment Plan`);
  lines.push(`\n**Hypothesis:** ${hypothesis}\n`);
  lines.push(`**Domain:** ${plan.domain}\n`);

  lines.push(`\n## Overview\n`);
  lines.push(`- **Restated hypothesis:** ${plan.overview.restated_hypothesis}`);
  lines.push(`- **Objective:** ${plan.overview.objective}`);
  lines.push(`- **Control condition:** ${plan.overview.control_condition}`);
  lines.push(`- **Success criteria:** ${plan.overview.success_criteria}`);

  lines.push(`\n## Protocol\n`);
  plan.protocol.forEach((s) => {
    lines.push(`### Step ${s.step}. ${s.title} _(${s.duration})_`);
    lines.push(s.description);
    if (s.equipment?.length) lines.push(`- Equipment: ${s.equipment.join(", ")}`);
    if (isMeaningfulSafetyNote(s.safety_notes)) lines.push(`- Safety: ${s.safety_notes}`);
    lines.push("");
  });

  lines.push(`\n## Materials\n`);
  lines.push(`| Reagent | Catalog | Supplier | Qty | Unit cost | Notes |`);
  lines.push(`|---|---|---|---|---|---|`);
  plan.materials.forEach((m) => {
    lines.push(`| ${m.name} | ${m.catalog_number} | ${m.supplier} | ${m.quantity} | ${formatUSD(m.unit_cost_usd)} | ${m.notes ?? ""} |`);
  });

  lines.push(`\n## Budget\n`);
  lines.push(`| Category | Item | Amount | Notes |`);
  lines.push(`|---|---|---|---|`);
  plan.budget.forEach((b) => {
    lines.push(`| ${b.category} | ${b.item} | ${formatUSD(b.amount_usd)} | ${b.notes ?? ""} |`);
  });
  const total = plan.budget.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0);
  lines.push(`\n**Total: ${formatUSD(total)}**`);

  lines.push(`\n## Timeline\n`);
  plan.timeline.forEach((t) => {
    lines.push(`- **${formatTimelineWeeks(t.start_week, t.end_week)} · ${t.phase}** — ${t.deliverable}${t.depends_on?.length ? ` _(depends on: ${t.depends_on.join(", ")})_` : ""}`);
  });

  lines.push(`\n## Validation\n`);
  lines.push(`- **Primary endpoint:** ${plan.validation.primary_endpoint}`);
  lines.push(`- **Statistical approach:** ${plan.validation.statistical_approach}`);
  lines.push(`- **Decision criteria:** ${plan.validation.decision_criteria}`);
  if (plan.validation.risks?.length) {
    lines.push(`- **Risks:**`);
    plan.validation.risks.forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join("\n");
}
