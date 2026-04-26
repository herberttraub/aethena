import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UploadDropzone } from "./UploadDropzone";

interface Props {
  onSubmit: (hypothesis: string, files: File[]) => void;
  loading: boolean;
  initialValue?: string;
}

const SAMPLES = [
  {
    label: "Cryopreservation",
    text: "Replacing sucrose with trehalose as a cryoprotectant will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard 10% DMSO protocol, by reducing intracellular ice formation.",
  },
  {
    label: "Neural organoids",
    text: "Pulsed optogenetic stimulation at 40 Hz of cortical organoids will accelerate maturation of GABAergic interneurons, measured as a ≥30% increase in parvalbumin+ cells by day 60 versus unstimulated controls.",
  },
  {
    label: "Microbiome",
    text: "Daily supplementation with Akkermansia muciniphila in a high-fat-diet mouse model will reduce intestinal permeability (FITC-dextran assay) by 25% within 4 weeks, mediated by upregulation of tight junction proteins ZO-1 and occludin.",
  },
];

export function HypothesisInput({ onSubmit, loading, initialValue = "" }: Props) {
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<File[]>([]);

  const ok = useMemo(() => value.trim().length >= 30, [value]);

  return (
    <section className="mx-auto max-w-3xl px-6 pt-20 pb-16">
      <div className="text-center mb-10">
        <h1
          className="text-5xl md:text-6xl leading-[1.05] text-foreground"
          style={{ fontFamily: '"DM Serif Display", serif' }}
        >
          Let's create your{" "}
          <em
            className="italic"
            style={{ color: "hsl(192 75% 38%)", fontFamily: '"DM Serif Display", serif' }}
          >
            plan
          </em>
        </h1>
      </div>

      <div className="lab-card p-1.5">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Replacing sucrose with trehalose as a cryoprotectant will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol…"
          rows={6}
          className="resize-none border-0 bg-transparent text-base leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-3"
          disabled={loading}
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {value.trim().length} chars · aim for a specific intervention, measurable outcome, threshold, mechanism, control
          </span>
          <Button
            disabled={!ok || loading}
            onClick={() => onSubmit(value.trim(), files)}
            size="sm"
            className="gap-1.5"
          >
            {loading ? "Checking literature…" : "Run literature check"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <UploadDropzone files={files} onChange={setFiles} disabled={loading} />
      </div>

      <div className="mt-10">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
          <Sparkles className="h-3.5 w-3.5 text-brass" />
          Try an example
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={loading}
              onClick={() => setValue(s.text)}
              className="lab-card text-left p-3 hover:border-brass/60 transition-colors disabled:opacity-50"
            >
              <div className="font-serif text-base text-foreground">{s.label}</div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                {s.text}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
