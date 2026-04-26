import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  Coins,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  Microscope,
  Pencil,
  Star,
  TestTubeDiagonal,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ExperimentPlan } from "@/lib/scientist-types";
import { formatTimelineWeeks, formatUSD, isMeaningfulSafetyNote, planToMarkdown } from "@/lib/scientist-utils";
import { exportPdf, exportDocx, exportLatex } from "@/lib/scientist-exports";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { BudgetDonut } from "./BudgetDonut";
import { CollaboratorsPanel } from "./CollaboratorsPanel";
import { EquipmentPanel } from "./EquipmentPanel";
import { ConstructionTimeline } from "./ConstructionTimeline";
import { InlineFeedback } from "./InlineFeedback";
import { MaterialsSchedule } from "./MaterialsSchedule";

// Each section gets a distinct color used for the nav button AND the section header.
// Color is an HSL triplet string (no `hsl()` wrapper) so we can compose tints inline.
// All sections share the overview color (ocean teal). Only the budget pie chart
// uses a differentiated palette.
const SECTION_COLOR = "192 75% 38%";

const SECTIONS = [
  { id: "overview",     label: "Overview",     icon: Microscope,        color: SECTION_COLOR },
  { id: "protocol",     label: "Protocol",     icon: ClipboardList,     color: SECTION_COLOR },
  { id: "materials",    label: "Materials",    icon: TestTubeDiagonal,  color: SECTION_COLOR },
  { id: "budget",       label: "Budget",       icon: Coins,             color: SECTION_COLOR },
  { id: "timeline",     label: "Timeline",     icon: CalendarRange,     color: SECTION_COLOR },
  { id: "validation",   label: "Validation",   icon: FlaskConical,      color: SECTION_COLOR },
  { id: "collaborators",label: "Collaborators",icon: Users,             color: SECTION_COLOR },
  { id: "equipment",    label: "Equipment",    icon: Wrench,            color: SECTION_COLOR },
] as const;

const SECTION_COLORS: Record<string, string> = SECTIONS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.color }),
  {} as Record<string, string>,
);


interface ReviewState {
  [section: string]: {
    rating?: number;
    note?: string;
    original?: string;
    corrected?: string;
  };
}

interface Props {
  plan: ExperimentPlan;
  hypothesis: string;
  planId: string;
  feedbackApplied: number;
  onNew: () => void;
}

export function PlanView({ plan, hypothesis, planId, feedbackApplied, onNew }: Props) {
  const [reviewMode, setReviewMode] = useState(false);
  const [openStepFeedback, setOpenStepFeedback] = useState<number | null>(null);
  const [author, setAuthor] = useState("");
  const [reviews, setReviews] = useState<ReviewState>({});
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<typeof SECTIONS[number]["id"]>("overview");

  function switchTab(id: typeof SECTIONS[number]["id"]) {
    setActiveTab(id);
    // After the new panel mounts, bring its header to the top of the viewport,
    // accounting for the sticky site header. We use a generous offset so the
    // section title is fully visible (not flush against the banner).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
          const headerOffset = 96; // sticky site header + breathing room
          const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
          window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });
  }

  const totalBudget = useMemo(
    () => plan.budget.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0),
    [plan.budget],
  );
  const maxWeek = useMemo(
    () => plan.timeline.reduce((m, t) => Math.max(m, t.end_week), 1),
    [plan.timeline],
  );

  const budgetByCategory = useMemo(() => {
    const map = new Map<string, number>();
    plan.budget.forEach((b) => map.set(b.category, (map.get(b.category) ?? 0) + b.amount_usd));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
  }, [plan.budget]);

  function setReview(section: string, patch: Partial<ReviewState[string]>) {
    setReviews((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
  }

  async function submitReviews() {
    const items = Object.entries(reviews)
      .filter(([, v]) => v && (v.rating || v.note || v.corrected))
      .map(([section, v]) => ({
        section,
        rating: v.rating ?? null,
        correction_text: v.note ?? null,
        original_value: v.original ?? null,
        corrected_value: v.corrected ?? null,
      }));

    if (items.length === 0) {
      toast.error("Add a rating or correction to at least one section before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      await api.submitReview({
        plan_id: planId,
        author: author || "Anonymous Scientist",
        items,
      });
      toast.success("Feedback saved", {
        description: "Future plans for this domain will reflect your corrections.",
      });
      setReviews({});
      setReviewMode(false);
    } catch (e: any) {
      toast.error("Could not save feedback", { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }

  function exportMarkdown() {
    const md = planToMarkdown(plan, hypothesis);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "experiment-plan.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport(fmt: "pdf" | "docx" | "latex" | "markdown") {
    try {
      if (fmt === "pdf") exportPdf(plan, hypothesis);
      else if (fmt === "docx") await exportDocx(plan, hypothesis);
      else if (fmt === "latex") exportLatex(plan, hypothesis);
      else exportMarkdown();
      toast.success(`Exported as ${fmt.toUpperCase()}`);
    } catch (e: any) {
      toast.error("Export failed", { description: e?.message });
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied");
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero header */}
      <div className="lab-card p-6 md:p-8 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft text-primary-deep px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] font-medium">
                {plan.domain}
              </span>
              {feedbackApplied > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-foreground/70">
                  <Star className="h-3 w-3" /> {feedbackApplied} prior corrections applied
                </span>
              )}
            </div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Hypothesis</p>
            <h1 className="font-serif text-2xl md:text-3xl text-foreground leading-snug mt-1">
              "{hypothesis}"
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyLink} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Link
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> Export
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => handleExport("pdf")}>PDF (.pdf)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("docx")}>Word (.docx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("latex")}>LaTeX (.tex)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("markdown")}>Markdown (.md)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Protocol steps" value={plan.protocol.length.toString()} />
          <Stat label="Materials" value={plan.materials.length.toString()} />
          <Stat label="Total budget" value={formatUSD(totalBudget)} />
          <Stat label="Timeline" value={`${maxWeek} weeks`} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
        {/* Sticky tab nav — clicking switches the panel and scrolls to top */}
        <aside className="md:sticky md:top-20 md:self-start">
          <nav className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0" aria-label="Plan sections">
            {SECTIONS.map((s) => {
              const isActive = activeTab === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => switchTab(s.id)}
                  aria-current={isActive ? "page" : undefined}
                  className="px-3 py-2 rounded-md text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap border transition-all hover:brightness-110 hover:-translate-y-px text-left"
                  style={{
                    background: isActive ? `hsl(${s.color})` : `hsl(${s.color} / 0.10)`,
                    color: isActive ? "hsl(0 0% 100%)" : `hsl(${s.color})`,
                    borderColor: `hsl(${s.color} / ${isActive ? 1 : 0.45})`,
                    boxShadow: isActive
                      ? `0 1px 0 hsl(${s.color} / 0.35), 0 4px 10px hsl(${s.color} / 0.25)`
                      : "none",
                  }}
                >
                  <s.icon className="h-3.5 w-3.5" />
                  {s.label}
                </button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={onNew}
              className="mt-3 w-full justify-start gap-1.5"
            >
              ← New hypothesis
            </Button>
          </nav>
        </aside>

        {/* Sections */}
        <div className="space-y-10 min-w-0">
          {/* Overview */}
          {activeTab === "overview" && (
          <Section id="overview" title="Overview" icon={Microscope}>
            {reviewMode && (
              <RatingBar value={reviews.overview?.rating} onChange={(r) => setReview("overview", { rating: r })} />
            )}
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field tone={SECTION_COLORS.overview} label="Restated hypothesis" value={plan.overview.restated_hypothesis} />
              <Field tone={SECTION_COLORS.overview} label="Objective" value={plan.overview.objective} />
              <Field tone={SECTION_COLORS.overview} label="Control condition" value={plan.overview.control_condition} />
              <Field tone={SECTION_COLORS.overview} label="Success criteria" value={plan.overview.success_criteria} />
            </dl>
            {reviewMode && (
              <CorrectionBox section="overview" reviews={reviews} setReview={setReview} placeholder="What's wrong with this overview?" />
            )}
            <InlineFeedback planId={planId} section="overview" />
          </Section>
          )}

          {/* Protocol */}
          {activeTab === "protocol" && (
          <Section id="protocol" title="Protocol" icon={ClipboardList}>
            {reviewMode && (
              <RatingBar value={reviews.protocol?.rating} onChange={(r) => setReview("protocol", { rating: r })} />
            )}
            <ol className="space-y-3">
              {plan.protocol.map((s) => (
                <li key={s.step} className="lab-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 grid place-items-center h-7 w-7 rounded-full bg-primary-soft text-primary-deep text-sm font-medium">
                      {s.step}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-medium text-foreground">{s.title}</h3>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{s.duration}</span>
                          <button
                            type="button"
                            aria-label={`Edit step ${s.step}`}
                            onClick={() =>
                              setOpenStepFeedback((cur) => (cur === s.step ? null : s.step))
                            }
                            className={
                              "p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors " +
                              (openStepFeedback === s.step ? "bg-muted text-foreground" : "")
                            }
                            title="Suggest a correction for this step"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-foreground/90 mt-1.5 leading-relaxed">{s.description}</p>
                      {s.materials && s.materials.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
                            Materials
                          </span>
                          {s.materials.map((mat, mi) => (
                            <button
                              key={mi}
                              type="button"
                              onClick={() => switchTab("materials")}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs border transition-colors hover:brightness-105"
                              style={{
                                background: "hsl(28 65% 50% / 0.10)",
                                borderColor: "hsl(28 65% 50% / 0.35)",
                                color: "hsl(28 65% 36%)",
                              }}
                            >
                              {mat}
                            </button>
                          ))}
                        </div>
                      )}
                      {s.equipment?.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
                            Equipment
                          </span>
                          {s.equipment.map((eq, ei) => (
                            <button
                              key={ei}
                              type="button"
                              onClick={() => {
                                switchTab("equipment");
                                // Wait for the equipment panel to mount before scrolling to it.
                                const slug = eq.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                                const tryHighlight = (attempt = 0) => {
                                  const target = document.getElementById(`equipment-${slug}`);
                                  if (target) {
                                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                                    target.classList.add("equipment-highlight");
                                    setTimeout(() => target.classList.remove("equipment-highlight"), 2000);
                                  } else if (attempt < 20) {
                                    setTimeout(() => tryHighlight(attempt + 1), 150);
                                  }
                                };
                                setTimeout(() => tryHighlight(), 200);
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs border transition-colors hover:brightness-105"
                              style={{
                                background: "hsl(140 40% 36% / 0.10)",
                                borderColor: "hsl(140 40% 36% / 0.35)",
                                color: "hsl(140 40% 28%)",
                              }}
                            >
                              {eq}
                            </button>
                          ))}
                        </div>
                      )}
                      {isMeaningfulSafetyNote(s.safety_notes) && (
                        <p className="text-xs mt-1.5 inline-flex items-start gap-1.5 text-clay">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {s.safety_notes}
                        </p>
                      )}
                      {openStepFeedback === s.step && (
                        <div className="mt-3">
                          <InlineFeedback
                            planId={planId}
                            section={`protocol.step_${s.step}`}
                            originalValue={`${s.title} — ${s.description}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {reviewMode && (
              <CorrectionBox section="protocol" reviews={reviews} setReview={setReview} placeholder="Which step is off?" />
            )}
            <InlineFeedback planId={planId} section="protocol" />
          </Section>
          )}

          {/* Materials */}
          {activeTab === "materials" && (
          <Section id="materials" title="Materials & supply chain" icon={TestTubeDiagonal}>
            {reviewMode && (
              <RatingBar value={reviews.materials?.rating} onChange={(r) => setReview("materials", { rating: r })} />
            )}
            <div className="lab-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Material</th>
                      <th className="text-left px-4 py-2.5 font-medium">Catalog</th>
                      <th className="text-left px-4 py-2.5 font-medium">Supplier</th>
                      <th className="text-left px-4 py-2.5 font-medium">Qty</th>
                      <th className="text-right px-4 py-2.5 font-medium">Unit cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.materials.map((m, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{m.name}</div>
                          {m.notes && <div className="text-xs text-muted-foreground mt-0.5">{m.notes}</div>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.catalog_number}</td>
                        <td className="px-4 py-3 text-foreground">
                          {m.link ? (
                            <a
                              href={m.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:text-brass-deep"
                            >
                              {m.supplier} <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            m.supplier
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{m.quantity}</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">{formatUSD(m.unit_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {reviewMode && (
              <CorrectionBox section="materials" reviews={reviews} setReview={setReview} placeholder="Wrong supplier or catalog #?" />
            )}
            <MaterialsSchedule plan={plan} />
            <InlineFeedback planId={planId} section="materials" />
          </Section>
          )}

          {/* Budget */}
          {activeTab === "budget" && (
          <Section id="budget" title="Budget" icon={Coins}>
            {reviewMode && (
              <RatingBar value={reviews.budget?.rating} onChange={(r) => setReview("budget", { rating: r })} />
            )}
            <div className="lab-card p-5 mb-4">
              <BudgetDonut data={budgetByCategory} />
            </div>
            <div className="lab-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Category</th>
                    <th className="text-left px-4 py-2.5 font-medium">Item</th>
                    <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.budget.map((b, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2.5 text-muted-foreground">{b.category}</td>
                      <td className="px-4 py-2.5 text-foreground">
                        {b.item}
                        {b.notes && <span className="block text-xs text-muted-foreground mt-0.5">{b.notes}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatUSD(b.amount_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reviewMode && (
              <CorrectionBox section="budget" reviews={reviews} setReview={setReview} placeholder="Budget unrealistic?" />
            )}
            <InlineFeedback planId={planId} section="budget" />
          </Section>
          )}

          {/* Timeline */}
          {activeTab === "timeline" && (
          <Section id="timeline" title="Timeline" icon={CalendarRange}>
            {reviewMode && (
              <RatingBar value={reviews.timeline?.rating} onChange={(r) => setReview("timeline", { rating: r })} />
            )}
            <ConstructionTimeline timeline={plan.timeline} maxWeek={maxWeek} />
            {reviewMode && (
              <CorrectionBox section="timeline" reviews={reviews} setReview={setReview} placeholder="Unrealistic timeline?" />
            )}
            <InlineFeedback planId={planId} section="timeline" />
          </Section>
          )}

          {/* Validation */}
          {activeTab === "validation" && (
          <Section id="validation" title="Validation" icon={FlaskConical}>
            {reviewMode && (
              <RatingBar value={reviews.validation?.rating} onChange={(r) => setReview("validation", { rating: r })} />
            )}
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field tone={SECTION_COLORS.validation} label="Primary endpoint" value={plan.validation.primary_endpoint} />
              <Field tone={SECTION_COLORS.validation} label="Statistical approach" value={plan.validation.statistical_approach} />
              <Field tone={SECTION_COLORS.validation} label="Decision criteria" value={plan.validation.decision_criteria} />
              <div
                className="rounded-lg p-4 border"
                style={{
                  background: `linear-gradient(180deg, hsl(${SECTION_COLORS.validation} / 0.08), hsl(${SECTION_COLORS.validation} / 0.03))`,
                  borderColor: `hsl(${SECTION_COLORS.validation} / 0.30)`,
                }}
              >
                <p
                  className="text-[11px] uppercase tracking-[0.14em] mb-2 font-medium"
                  style={{ color: `hsl(${SECTION_COLORS.validation})` }}
                >
                  Risks
                </p>
                <ul className="space-y-1.5">
                  {plan.validation.risks.map((r, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-2">
                      <AlertTriangle
                        className="h-3.5 w-3.5 mt-0.5 shrink-0"
                        style={{ color: `hsl(${SECTION_COLORS.validation})` }}
                      />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </dl>
            {reviewMode && (
              <CorrectionBox section="validation" reviews={reviews} setReview={setReview} placeholder="Wrong statistical test?" />
            )}
            <InlineFeedback planId={planId} section="validation" />
          </Section>
          )}

          {/* Collaborators */}
          {activeTab === "collaborators" && (
          <Section id="collaborators" title="Find collaborators" icon={Users}>
            <CollaboratorsPanel hypothesis={hypothesis} plan={plan} />
            <InlineFeedback planId={planId} section="collaborators" />
          </Section>
          )}

          {/* Equipment */}
          {activeTab === "equipment" && (
          <Section id="equipment" title="Source equipment locally" icon={Wrench}>
            <EquipmentPanel plan={plan} />
            <InlineFeedback planId={planId} section="equipment" />
          </Section>
          )}

          {reviewMode && (
            <div className="lab-card p-5 sticky bottom-4 bg-card/95 backdrop-blur">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Your name (optional)"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setReviewMode(false)}>
                    Cancel
                  </Button>
                  <Button onClick={submitReviews} disabled={submitting}>
                    {submitting ? "Saving…" : "Submit feedback"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                These corrections will be retrieved as few-shot examples when generating future plans for similar experiments.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg px-4 py-3 bg-card/60">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-serif text-2xl text-foreground mt-1">{value}</div>
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  const color = SECTION_COLORS[id] ?? "192 75% 38%";
  return (
    <section id={id} className="scroll-mt-24">
      <div
        className="flex items-center gap-3 mb-4 rounded-lg px-3 py-2 border"
        style={{
          background: `linear-gradient(180deg, hsl(${color} / 0.10), hsl(${color} / 0.04))`,
          borderColor: `hsl(${color} / 0.28)`,
        }}
      >
        <span
          className="grid place-items-center h-8 w-8 rounded-md"
          style={{ background: `hsl(${color})`, color: "hsl(0 0% 100%)" }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="font-serif text-2xl" style={{ color: `hsl(${color})` }}>{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const t = tone ?? "192 75% 38%";
  return (
    <div
      className="rounded-lg p-4 border transition-colors"
      style={{
        background: `linear-gradient(180deg, hsl(${t} / 0.07), hsl(${t} / 0.02))`,
        borderColor: `hsl(${t} / 0.28)`,
      }}
    >
      <dt
        className="text-[11px] uppercase tracking-[0.14em] font-medium"
        style={{ color: `hsl(${t})` }}
      >
        {label}
      </dt>
      <dd className="text-sm text-foreground mt-1.5 leading-relaxed">{value}</dd>
    </div>
  );
}

function RatingBar({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 mb-2">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mr-2">Rate this section</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`h-6 w-6 grid place-items-center rounded transition-colors ${
            value && n <= value ? "text-brass-deep" : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label={`Rate ${n}`}
        >
          <Star className="h-4 w-4" fill={value && n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

function CorrectionBox({
  section,
  reviews,
  setReview,
  placeholder,
}: {
  section: string;
  reviews: ReviewState;
  setReview: (section: string, patch: Partial<ReviewState[string]>) => void;
  placeholder: string;
}) {
  const r = reviews[section] ?? {};
  return (
    <div className="lab-card p-3 bg-primary-soft/40 border-brass/30 mt-2">
      <Textarea
        rows={2}
        value={r.note ?? ""}
        onChange={(e) => setReview(section, { note: e.target.value })}
        placeholder={placeholder}
        className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm resize-none"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
        <Input
          placeholder="What was generated (optional)"
          value={r.original ?? ""}
          onChange={(e) => setReview(section, { original: e.target.value })}
          className="text-xs h-8"
        />
        <Input
          placeholder="What it should be (optional)"
          value={r.corrected ?? ""}
          onChange={(e) => setReview(section, { corrected: e.target.value })}
          className="text-xs h-8"
        />
      </div>
    </div>
  );
}
