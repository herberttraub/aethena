// MaterialsSchedule — links each material to the earliest timeline week
// where it's needed, so the user knows when to order what.
// Heuristic: for each material, find the first protocol step whose title /
// description / equipment mentions any meaningful word from the material name,
// then map that step to a timeline phase by step ordering.
import { useMemo } from "react";
import { Calendar, Package, ShoppingCart } from "lucide-react";
import type { ExperimentPlan, Material } from "@/lib/scientist-types";
import { formatUSD } from "@/lib/scientist-utils";

interface Props {
  plan: ExperimentPlan;
}

const STOP = new Set([
  "the","and","for","with","from","kit","buffer","reagent","grade","high","low","pure","purified",
  "solution","powder","cells","cell","media","medium","ml","mg","ug","l","of","a","an","to","in",
]);

function tokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

interface ScheduledMaterial extends Material {
  needBy: number; // week number (1 = ASAP)
  stepIndex: number | null;
  phase: string | null;
}

function scheduleMaterials(plan: ExperimentPlan): ScheduledMaterial[] {
  const protocolText = plan.protocol.map((p) =>
    [p.title, p.description, ...(p.equipment ?? [])].join(" ").toLowerCase(),
  );

  // Step → earliest week, derived from timeline ordering.
  // We assume the timeline phases roughly follow protocol step order.
  // For each protocol step index, find the timeline phase covering that fraction.
  const totalSteps = plan.protocol.length || 1;
  const phasesSorted = [...plan.timeline].sort((a, b) => a.start_week - b.start_week);
  function stepWeek(stepIdx: number): { week: number; phase: string | null } {
    if (phasesSorted.length === 0) return { week: 1, phase: null };
    const idx = Math.min(
      phasesSorted.length - 1,
      Math.floor((stepIdx / totalSteps) * phasesSorted.length),
    );
    const phase = phasesSorted[idx];
    return { week: phase.start_week, phase: phase.phase };
  }

  return plan.materials.map((m) => {
    const matToks = tokens(`${m.name} ${m.notes ?? ""}`);
    let stepIndex: number | null = null;
    if (matToks.length) {
      for (let i = 0; i < protocolText.length; i++) {
        if (matToks.some((t) => protocolText[i].includes(t))) {
          stepIndex = i;
          break;
        }
      }
    }
    const { week, phase } = stepIndex == null
      ? { week: 1, phase: phasesSorted[0]?.phase ?? null } // unmatched → order ASAP
      : stepWeek(stepIndex);
    return { ...m, needBy: week, stepIndex, phase };
  });
}

// Standard academic procurement lead times (weeks). Conservative defaults.
function leadWeeks(supplier: string): number {
  const s = (supplier ?? "").toLowerCase();
  if (/sigma|aldrich|millipore|thermo|fisher|invitrogen|vwr/.test(s)) return 1;
  if (/idt|integrated dna|twist|genscript|addgene/.test(s)) return 2;
  if (/custom|peptide|antibody/.test(s)) return 3;
  return 2;
}

export function MaterialsSchedule({ plan }: Props) {
  const scheduled = useMemo(() => scheduleMaterials(plan), [plan]);

  // Group by need-by week so the user sees a clean ordering schedule.
  const byWeek = useMemo(() => {
    const map = new Map<number, ScheduledMaterial[]>();
    scheduled.forEach((m) => {
      const orderBy = Math.max(1, m.needBy - leadWeeks(m.supplier));
      const list = map.get(orderBy) ?? [];
      list.push(m);
      map.set(orderBy, list);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [scheduled]);

  if (byWeek.length === 0) return null;

  return (
    <div className="lab-card p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingCart className="h-4 w-4 text-brass-deep" />
        <h3 className="font-serif text-lg text-foreground">Procurement schedule</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        When to place each order so reagents arrive in time for the step that needs them
        (lead times estimated from supplier).
      </p>
      <ol className="space-y-3">
        {byWeek.map(([orderWeek, items]) => (
          <li key={orderWeek} className="border-l-2 border-brass/40 pl-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft text-primary-deep px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider">
                <Calendar className="h-3 w-3" /> Order by week {orderWeek}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {items.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Package className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-foreground truncate">{m.name}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        needed week {m.needBy}
                        {m.phase ? ` · ${m.phase}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.supplier} · {m.quantity} · {formatUSD(m.unit_cost_usd)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
