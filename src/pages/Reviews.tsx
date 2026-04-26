import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, MessageSquare, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { api } from "@/lib/api";
import { formatUSD } from "@/lib/scientist-utils";
import type { ExperimentPlan } from "@/lib/scientist-types";

interface PlanRow {
  id: string;
  hypothesis: string;
  domain: string | null;
  plan: ExperimentPlan | null;
  created_at: string;
  reviewCount: number;
}

const Reviews = () => {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listPlans(40);
        setRows(list);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-5xl w-full px-6 py-12">
        <div className="mb-8">
          <h1 className="font-serif text-4xl text-foreground">Past plans</h1>
          <p className="text-muted-foreground mt-2">
            Every plan you've generated. Click any one to open it. Reviews you leave feed into future plans for the same domain.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="lab-card p-10 text-center">
            <Sparkles className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="mt-3 text-foreground">No plans generated yet.</p>
            <Link to="/" className="text-primary hover:underline text-sm inline-flex items-center gap-1 mt-2">
              Generate your first plan <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const total = r.plan?.budget?.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0) ?? 0;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/?plan=${r.id}`)}
                    className="w-full text-left lab-card p-5 hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {r.domain && (
                            <span className="inline-flex items-center rounded-full bg-primary-soft text-primary-deep px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] font-medium">
                              {r.domain}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString()}
                          </span>
                          {r.reviewCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-primary-deep bg-secondary px-2 py-0.5 rounded-full">
                              <MessageSquare className="h-3 w-3" /> {r.reviewCount} review{r.reviewCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <p className="font-serif text-lg text-foreground leading-snug line-clamp-2">
                          "{r.hypothesis}"
                        </p>
                        {r.plan && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {r.plan.protocol?.length ?? 0} steps · {r.plan.materials?.length ?? 0} materials · budget {formatUSD(total)}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground self-center shrink-0" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
};

export default Reviews;

