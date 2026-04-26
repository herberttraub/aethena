import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { HypothesisInput } from "@/components/HypothesisInput";
import { LiteratureQc } from "@/components/LiteratureQc";
import { PlanView } from "@/components/PlanView";
import { DepthModal } from "@/components/DepthModal";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { Depth, ExperimentPlan, QcResult } from "@/lib/scientist-types";

type Stage = "input" | "qc" | "plan";

const Index = () => {
  const [stage, setStage] = useState<Stage>("input");
  const [hypothesis, setHypothesis] = useState("");
  const [uploadSummary, setUploadSummary] = useState<string>("");
  const [qcLoading, setQcLoading] = useState(false);
  const [qc, setQc] = useState<QcResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [plan, setPlan] = useState<ExperimentPlan | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [feedbackApplied, setFeedbackApplied] = useState(0);
  const [depthOpen, setDepthOpen] = useState(false);
  const [lastDepth, setLastDepth] = useState<Depth>("regular");
  const [searchParams, setSearchParams] = useSearchParams();

  // Load a saved plan if URL has ?plan=<id>, or reset to fresh form if ?new=…
  useEffect(() => {
    const newParam = searchParams.get("new");
    if (newParam) {
      // Header "New plan" was clicked — clear all state and the param.
      setStage("input");
      setQc(null);
      setPlan(null);
      setPlanId("");
      setFeedbackApplied(0);
      setUploadSummary("");
      setHypothesis("");
      setSearchParams({}, { replace: true });
      return;
    }
    const planParam = searchParams.get("plan");
    if (!planParam || planParam === planId) return;
    (async () => {
      try {
        const r = await api.getPlan(planParam);
        if (!r?.plan) throw new Error("missing plan");
        setHypothesis(r.hypothesis);
        setPlan(r.plan);
        setQc(r.qc_result);
        setPlanId(r.id);
        setFeedbackApplied(0);
        setStage("plan");
      } catch (e: any) {
        toast.error("Couldn't load that plan", { description: e?.message });
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams, planId, setSearchParams]);

  async function parseUploads(files: File[]): Promise<string> {
    if (files.length === 0) return "";
    try {
      const data = await api.parseUploads(files);
      return data?.summary ?? "";
    } catch (e) {
      console.error("parse-uploads error:", e);
      return "";
    }
  }

  async function runQc(h: string, files: File[]) {
    setHypothesis(h);
    setStage("qc");
    setQc(null);
    setQcLoading(true);
    try {
      const summary = await parseUploads(files);
      setUploadSummary(summary);
      const data = await api.literatureQc({ hypothesis: h, upload_summary: summary });
      setQc(data);
    } catch (e: any) {
      toast.error("Literature check failed", { description: e?.message ?? "Try again in a moment." });
      setStage("input");
    } finally {
      setQcLoading(false);
    }
  }

  function openDepth() {
    if (!hypothesis) return;
    setDepthOpen(true);
  }

  async function generatePlan(depth: Depth) {
    setDepthOpen(false);
    if (!hypothesis) return;
    setLastDepth(depth);
    setGenerating(true);
    try {
      const payload = await api.generatePlan({ hypothesis, qc, depth, upload_summary: uploadSummary });
      setPlan(payload.plan);
      setPlanId(payload.id);
      setFeedbackApplied(payload.feedback_applied ?? 0);
      setStage("plan");
    } catch (e: any) {
      toast.error("Plan generation failed", { description: e?.message ?? "Try again in a moment." });
    } finally {
      setGenerating(false);
    }
  }

  async function regenerate() {
    if (!hypothesis || regenerating) return;
    setRegenerating(true);
    try {
      const payload = await api.generatePlan({
        hypothesis,
        qc,
        depth: lastDepth,
        upload_summary: uploadSummary,
      });
      setPlan(payload.plan);
      setPlanId(payload.id);
      setFeedbackApplied(payload.feedback_applied ?? 0);
      toast.success(
        payload.feedback_applied
          ? `Regenerated with ${payload.feedback_applied} prior correction${payload.feedback_applied === 1 ? "" : "s"} applied`
          : "Regenerated",
      );
    } catch (e: any) {
      toast.error("Regeneration failed", { description: e?.message ?? "Try again in a moment." });
    } finally {
      setRegenerating(false);
    }
  }

  function reset() {
    setStage("input");
    setQc(null);
    setPlan(null);
    setPlanId("");
    setFeedbackApplied(0);
    setUploadSummary("");
    if (searchParams.get("plan")) setSearchParams({}, { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {stage === "input" && <HypothesisInput onSubmit={runQc} loading={qcLoading} initialValue={hypothesis} />}
        {stage === "qc" && (
          <LiteratureQc
            hypothesis={hypothesis}
            qc={qc}
            loading={qcLoading}
            onBack={reset}
            onContinue={openDepth}
            generating={generating}
          />
        )}
        {stage === "plan" && plan && (
          <PlanView
            plan={plan}
            hypothesis={hypothesis}
            planId={planId}
            feedbackApplied={feedbackApplied}
            references={qc?.references}
            onNew={reset}
            onRegenerate={regenerate}
            regenerating={regenerating}
          />
        )}
      </main>
      <DepthModal open={depthOpen} onOpenChange={setDepthOpen} onPick={generatePlan} />
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <span className="font-serif text-base">æthena</span> · your AI co-scientist
      </footer>
    </div>
  );
};

export default Index;
