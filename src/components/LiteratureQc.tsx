import { ArrowRight, BookOpen, ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { noveltyMeta } from "@/lib/scientist-utils";
import type { QcResult } from "@/lib/scientist-types";
import { PetriDishViz } from "./PetriDishViz";

interface Props {
  hypothesis: string;
  qc: QcResult | null;
  loading: boolean;
  onBack: () => void;
  onContinue: () => void;
  generating: boolean;
}

const PANEL_TONE: Record<"novel" | "similar" | "exact", string> = {
  novel: "bg-status-novel-soft border-sage/30",
  similar: "bg-status-similar-soft border-slateblue/30",
  exact: "bg-status-exact-soft border-clay/30",
};

const LABEL_BOX: Record<"novel" | "similar" | "exact", { bg: string; fg: string }> = {
  novel: { bg: "hsl(var(--status-novel-deep))", fg: "hsl(var(--status-novel-soft))" },
  similar: { bg: "hsl(var(--status-similar))", fg: "#ffffff" },
  exact: { bg: "hsl(var(--status-exact))", fg: "#ffffff" },
};

export function LiteratureQc({ hypothesis, qc, loading, onBack, onContinue, generating }: Props) {
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <div className="lab-card p-6 mb-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Hypothesis</p>
        <p className="font-serif text-xl text-foreground leading-snug">"{hypothesis}"</p>
      </div>

      {loading ? (
        <div className="lab-card p-10 text-center">
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-brass" />
          <p className="mt-3 text-sm text-muted-foreground">Searching Semantic Scholar and assessing novelty…</p>
        </div>
      ) : qc ? (
        <>
          <div className={`rounded-lg border p-6 mb-6 ${PANEL_TONE[noveltyMeta[qc.novelty].tone]}`}>
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
              <PetriDishViz novelty={qc.novelty} seed={hypothesis} />
              <div>
                {/* Novelty label in its own dark box */}
                <div
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-serif text-base"
                  style={{
                    backgroundColor: LABEL_BOX[noveltyMeta[qc.novelty].tone].bg,
                    color: LABEL_BOX[noveltyMeta[qc.novelty].tone].fg,
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                  {noveltyMeta[qc.novelty].label}
                </div>
                <p className="mt-3 text-base text-foreground max-w-2xl">{noveltyMeta[qc.novelty].description}</p>
                {qc.rationale && <p className="mt-2 text-sm text-foreground/70 italic">"{qc.rationale}"</p>}
                <div className="flex items-center gap-1.5 text-xs text-foreground/60 mt-3">
                  <Search className="h-3.5 w-3.5" /> {qc.searched} papers scanned
                </div>
              </div>
            </div>
          </div>

          {qc.references.length > 0 && (
            <div className="space-y-3 mb-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                <BookOpen className="h-3 w-3" /> Most relevant references
              </p>
              {qc.references.map((r, i) => (
                <article key={i} className="lab-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-lg text-foreground leading-snug">{r.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.authors?.slice(0, 3).join(", ")}
                        {r.authors && r.authors.length > 3 ? " et al." : ""}
                        {r.year ? ` · ${r.year}` : ""}
                        {r.venue ? ` · ${r.venue}` : ""}
                      </p>
                    </div>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs text-brass-deep hover:underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {r.abstract && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{r.abstract}</p>}
                </article>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button variant="outline" onClick={onBack}>
              Refine hypothesis
            </Button>
            <Button onClick={onContinue} disabled={generating} className="gap-1.5">
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating plan…
                </>
              ) : (
                <>
                  Generate experiment plan <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
