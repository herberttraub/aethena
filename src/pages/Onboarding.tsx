import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/SiteHeader";
import { auth } from "@/lib/auth";
import { toast } from "sonner";

const ROLES = [
  "Principal investigator / faculty",
  "Postdoctoral researcher",
  "PhD student",
  "Master's / undergraduate researcher",
  "Lab manager / staff scientist",
  "Industry researcher",
  "Other",
];

const RESEARCH_TYPES = [
  "Molecular biology",
  "Cell biology",
  "Genetics / genomics",
  "Neuroscience",
  "Immunology / vaccinology",
  "Microbiome / microbiology",
  "Materials science",
  "Photonics / photovoltaics",
  "Chemistry / drug discovery",
  "Bioengineering",
  "Computational / dry-lab",
  "Other",
];

const Onboarding = () => {
  const navigate = useNavigate();
  const user = auth.current();
  const [role, setRole] = useState(user?.role || "");
  const [researchType, setResearchType] = useState(user?.research_type || "");
  const [institution, setInstitution] = useState(user?.institution || "");
  const [busy, setBusy] = useState(false);

  // Bounce signed-out users back to login.
  useEffect(() => {
    if (!auth.isAuthed()) navigate("/login", { replace: true });
  }, [navigate]);

  async function save() {
    if (!role || !researchType || !institution.trim()) {
      toast.error("Pick your role, research area, and enter your institution.");
      return;
    }
    setBusy(true);
    try {
      await auth.updateProfile({
        role,
        research_type: researchType,
        institution: institution.trim(),
      });
      toast.success("Profile saved");
      navigate("/app", { replace: true });
    } catch (e: any) {
      toast.error("Couldn't save profile", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    // Skipping leaves onboarded=false, so the user is prompted again on next sign-in.
    navigate("/app", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center">
        <section className="mx-auto w-full max-w-xl px-6 py-12">
          <p className="text-xs uppercase tracking-[0.18em] text-primary mb-2">Step 1 of 1</p>
          <h1 className="text-4xl text-foreground" style={{ fontFamily: '"DM Serif Display", serif' }}>
            Tell us about your work
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            We use this to bias collaborator suggestions toward people in your network — for example,
            an MIT bioengineering PI sees nearby Harvard / Northeastern matches first. You can change
            any of this in your profile later.
          </p>

          <div className="mt-8 lab-card p-5 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Your role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select —</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Type of research</label>
              <select
                value={researchType}
                onChange={(e) => setResearchType(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select —</option>
                {RESEARCH_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Institution</label>
              <Input
                className="mt-1"
                placeholder="e.g. MIT, Stanford, Pfizer R&D, Mass General"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                disabled={busy}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used to suggest collaborators in your geographic / institutional network.
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={skip} disabled={busy}>
              Skip for now
            </Button>
            <Button onClick={save} disabled={busy} className="gap-1.5">
              {busy ? "Saving…" : "Continue"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Onboarding;
