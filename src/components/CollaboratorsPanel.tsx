import { useEffect, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Loader2, Mail, Send, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Collaborator, ExperimentPlan } from "@/lib/scientist-types";

interface Props {
  hypothesis: string;
  plan: ExperimentPlan;
}

export function CollaboratorsPanel({ hypothesis, plan }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Collaborator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [draftFor, setDraftFor] = useState<Collaborator | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.findCollaborators({ hypothesis, plan });
        if (cancelled) return;
        setItems(data?.collaborators ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not fetch collaborators");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hypothesis, plan]);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        Researchers with hands-on experience in the specific protocols, assays, or model systems your plan uses.
        Sourced from Semantic Scholar.
      </p>

      {loading ? (
        <div className="lab-card p-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-brass" />
          <p className="text-sm text-muted-foreground mt-2">Matching researchers to your specific protocols…</p>
        </div>
      ) : error ? (
        <div className="lab-card p-6 text-sm text-muted-foreground">
          Couldn't reach collaborator search: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="lab-card p-6 text-sm text-muted-foreground">
          <Users className="h-4 w-4 inline mr-1" /> No matches surfaced for this hypothesis yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((c, i) => {
            const isOpen = !!expanded[i];
            return (
              <article key={i} className="lab-card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg text-foreground leading-tight">{c.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.affiliation}</p>
                  </div>
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-brass-deep hover:underline inline-flex items-center gap-1"
                    >
                      Department page <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* Granular skill chips */}
                {c.matched_skills && c.matched_skills.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {c.matched_skills.map((s, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center rounded-md bg-status-novel-soft text-status-novel-deep px-2 py-0.5 text-[11px] font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Summary line, expandable */}
                <p className="text-sm text-foreground/85 mt-3 leading-relaxed">
                  {isOpen ? c.relevance : truncate(c.relevance, 110)}
                </p>
                {c.relevance && c.relevance.length > 110 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))}
                    className="self-start text-[11px] text-brass-deep hover:underline inline-flex items-center gap-1 mt-1"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    {isOpen ? "Less" : "More details"}
                  </button>
                )}

                {isOpen && c.top_paper_title && (
                  <p className="text-xs text-muted-foreground italic mt-2 line-clamp-3">
                    "{c.top_paper_title}"{c.top_paper_year ? ` · ${c.top_paper_year}` : ""}
                  </p>
                )}
                {isOpen && (c.h_index != null || c.paper_count != null) && (
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground font-mono">
                    {c.h_index != null && <span>h-index {c.h_index}</span>}
                    {c.paper_count != null && <span>{c.paper_count} papers</span>}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-border">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={() => setDraftFor(c)}
                  >
                    <Mail className="h-3.5 w-3.5" /> Draft outreach email
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <OutreachDialog
        collaborator={draftFor}
        hypothesis={hypothesis}
        onClose={() => setDraftFor(null)}
      />
    </div>
  );
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}

function OutreachDialog({
  collaborator,
  hypothesis,
  onClose,
}: {
  collaborator: Collaborator | null;
  hypothesis: string;
  onClose: () => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [senderName, setSenderName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!collaborator) {
      setSubject("");
      setBody("");
      return;
    }
    let cancelled = false;
    (async () => {
      setDrafting(true);
      try {
        const data = await api.draftOutreachEmail({
          hypothesis,
          collaborator,
          sender_name: senderName || undefined,
        });
        if (cancelled) return;
        setSubject(data?.subject ?? "");
        setBody(data?.body ?? "");
      } catch (e: any) {
        toast.error("Couldn't draft email", { description: e?.message });
      } finally {
        if (!cancelled) setDrafting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborator]);

  function copyAll() {
    const text = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(text);
    toast.success("Draft copied to clipboard");
  }

  function openMail() {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (body) params.set("body", body);
    window.location.href = `mailto:?${params.toString()}`;
  }

  return (
    <Dialog open={!!collaborator} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">
            Reach out to {collaborator?.name}
          </DialogTitle>
          <DialogDescription>
            A formal academic introduction. Edit anything before you send — every lab is different.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Your name</label>
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Jordan Smith, Graduate Researcher, MIT Bio"
              className="mt-1"
            />
          </div>

          {drafting ? (
            <div className="lab-card p-8 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-brass" />
              <p className="text-sm text-muted-foreground mt-2">Drafting a formal note…</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Subject</label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Body</label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="mt-1 font-serif text-[15px] leading-relaxed"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={copyAll} disabled={!body} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <Button size="sm" onClick={openMail} disabled={!body} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> Open in mail app
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
