import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/SiteHeader";
import { api } from "@/lib/api";
import { auth, type AuthUser } from "@/lib/auth";
import { toast } from "sonner";

interface Preference {
  id: string;
  section: string;
  before: string | null;
  after: string | null;
  freeform_note: string | null;
  experiment_type: string | null;
  domain: string | null;
  created_at: string;
}

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(auth.current());
  const [name, setName] = useState(user?.name || "");
  const [role, setRole] = useState(user?.role || "");
  const [researchType, setResearchType] = useState(user?.research_type || "");
  const [institution, setInstitution] = useState(user?.institution || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [prefs, setPrefs] = useState<Preference[] | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isAuthed()) {
      navigate("/login", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listPreferences();
        if (!cancelled) setPrefs(items);
      } catch (e: any) {
        if (!cancelled) setPrefsError(e?.message ?? "Could not load preferences");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const u = await auth.updateProfile({
        name: name || undefined,
        role: role || undefined,
        research_type: researchType || undefined,
        institution: institution || undefined,
      });
      setUser(u);
      toast.success("Profile updated");
    } catch (e: any) {
      toast.error("Could not save profile", { description: e?.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function deletePref(id: string) {
    setDeletingId(id);
    try {
      await api.deletePreference(id);
      setPrefs((cur) => (cur || []).filter((p) => p.id !== id));
      toast.success("Removed from learned preferences");
    } catch (e: any) {
      toast.error("Could not remove preference", { description: e?.message });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-4xl text-foreground" style={{ fontFamily: '"DM Serif Display", serif' }}>
            Profile &amp; preferences
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {user?.email}
          </p>

          {/* Profile fields */}
          <section className="mt-8 lab-card p-5">
            <h2 className="font-serif text-xl text-foreground mb-3">Your details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Name</label>
                <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Role</label>
                <Input className="mt-1" value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Type of research</label>
                <Input
                  className="mt-1"
                  value={researchType}
                  onChange={(e) => setResearchType(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Institution</label>
                <Input
                  className="mt-1"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button onClick={saveProfile} disabled={savingProfile} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {savingProfile ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </section>

          {/* Learned preferences */}
          <section className="mt-8">
            <h2 className="font-serif text-xl text-foreground mb-1">What the model has learned</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Every accepted correction you've submitted on a generated plan. These are folded into
              future plans for your team. Remove anything you no longer want to apply.
            </p>

            {prefs === null && !prefsError ? (
              <div className="lab-card p-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground mt-2">Loading…</p>
              </div>
            ) : prefsError ? (
              <div className="lab-card p-5 text-sm text-muted-foreground">
                Couldn't load preferences: {prefsError}
              </div>
            ) : prefs && prefs.length === 0 ? (
              <div className="lab-card p-5 text-sm text-muted-foreground">
                No corrections yet. Submit feedback on a generated plan and it'll show up here.
              </div>
            ) : (
              <ul className="space-y-2">
                {(prefs || []).map((p) => (
                  <li key={p.id} className="lab-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="inline-flex items-center rounded-full bg-primary-soft text-primary-deep px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] font-medium">
                            {p.section}
                          </span>
                          {p.domain && (
                            <span className="inline-flex items-center rounded-full bg-secondary text-foreground/70 px-2 py-0.5 text-[11px]">
                              {p.domain}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground ml-auto">
                            {new Date(p.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {p.before || p.after ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {p.before && (
                              <div className="text-xs">
                                <span className="text-muted-foreground">Before: </span>
                                <span className="text-foreground/90">{p.before}</span>
                              </div>
                            )}
                            {p.after && (
                              <div className="text-xs">
                                <span className="text-muted-foreground">After: </span>
                                <span className="text-foreground">{p.after}</span>
                              </div>
                            )}
                          </div>
                        ) : null}
                        {p.freeform_note && (
                          <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed whitespace-pre-line">
                            {p.freeform_note}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deletePref(p.id)}
                        disabled={deletingId === p.id}
                        className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
                        aria-label="Remove this preference"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === p.id ? "…" : "Remove"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </main>
    </div>
  );
};

export default Profile;
