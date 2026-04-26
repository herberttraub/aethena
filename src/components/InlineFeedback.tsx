import { useState } from "react";
import { ChevronDown, MessageSquarePlus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  planId: string;
  section: string;
  /** The current value being annotated (optional). */
  originalValue?: string;
}

/**
 * Compact, always-available per-section feedback widget.
 * Lives at the bottom of every section so the self-improvement loop is one click away.
 * Rating + free-text comment + an optional "what it should be" annotation.
 */
export function InlineFeedback({ planId, section, originalValue }: Props) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | undefined>();
  const [note, setNote] = useState("");
  const [corrected, setCorrected] = useState("");
  const [author, setAuthor] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!rating && !note.trim() && !corrected.trim()) {
      toast.error("Add a rating, comment, or correction first.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitReview({
        plan_id: planId,
        author: author || "Anonymous Scientist",
        items: [
          {
            section,
            rating: rating ?? null,
            correction_text: note || null,
            original_value: originalValue ?? null,
            corrected_value: corrected || null,
          },
        ],
      });
      toast.success("Thanks — feeding this back into future plans.");
      setRating(undefined);
      setNote("");
      setCorrected("");
      setOpen(false);
    } catch (e: any) {
      toast.error("Couldn't save", { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Rate, comment or annotate this section
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mr-2">Rating</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={`h-7 w-7 grid place-items-center rounded transition-colors ${
                  rating && n <= rating ? "text-brass-deep" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label={`Rate ${n} out of 5`}
                type="button"
              >
                <Star className="h-4 w-4" fill={rating && n <= rating ? "currentColor" : "none"} />
              </button>
            ))}
          </div>

          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Comment — what's off, what's missing, what's clever?"
            className="text-sm"
          />

          <Textarea
            rows={2}
            value={corrected}
            onChange={(e) => setCorrected(e.target.value)}
            placeholder="Annotation — what should this say instead? (optional)"
            className="text-sm"
          />

          <div className="flex items-center gap-2">
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name (optional)"
              className="text-sm h-9"
            />
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting ? "Saving…" : "Submit"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
