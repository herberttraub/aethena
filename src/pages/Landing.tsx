import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Microscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { auth } from "@/lib/auth";

const Landing = () => {
  const navigate = useNavigate();

  // If already logged in, jump straight to the app.
  useEffect(() => {
    if (auth.isAuthed()) navigate("/app", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-6 pt-20 pb-12 text-center">
          <h1
            className="text-5xl md:text-6xl leading-[1.05] text-foreground"
            style={{ fontFamily: '"DM Serif Display", serif' }}
          >
            Your AI{" "}
            <em
              className="italic"
              style={{ color: "hsl(192 75% 38%)", fontFamily: '"DM Serif Display", serif' }}
            >
              co-scientist
            </em>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            From a one-line hypothesis to a runnable experiment plan — protocol, materials, budget,
            timeline, and the people who can help. Built for working scientists.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-1.5">
              <Link to="/register">
                Register <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Login</Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <Link to="/app" className="hover:underline">
              or try a plan first &rarr;
            </Link>
          </p>
        </section>

        {/* Three-up overview */}
        <section className="mx-auto max-w-5xl px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="lab-card p-6">
              <BookOpen className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-serif text-xl text-foreground">Literature first</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Every plan starts with an honest novelty check against Semantic Scholar &mdash;
                "not found", "similar work", or "exact match" with cited references.
              </p>
            </div>
            <div className="lab-card p-6">
              <Microscope className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-serif text-xl text-foreground">Operationally grounded</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Real protocol steps, supplier catalog numbers, line-item budgets, week-by-week
                timelines &mdash; the artifacts a CRO would actually use to scope work.
              </p>
            </div>
            <div className="lab-card p-6">
              <Users className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-serif text-xl text-foreground">Collaborator matching</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Find researchers who've actually run the techniques in your plan, with draft outreach
                emails ready to send.
              </p>
            </div>
          </div>
        </section>

        {/* Self-learning callout */}
        <section className="mx-auto max-w-4xl px-6 py-12">
          <div
            className="lab-card p-8 text-center"
            style={{ background: "hsl(192 75% 38% / 0.06)", borderColor: "hsl(192 75% 38% / 0.25)" }}
          >
            <p className="text-xs uppercase tracking-[0.18em] text-primary mb-2">Self-learning</p>
            <h2
              className="text-3xl md:text-4xl text-foreground"
              style={{ fontFamily: '"DM Serif Display", serif' }}
            >
              Your team gets smarter with every correction.
            </h2>
            <p className="text-sm text-muted-foreground mt-3 max-w-2xl mx-auto leading-relaxed">
              Every fix you submit on a generated plan becomes a training signal for the next one.
              Future plans for similar experiment types reflect your team's standards automatically &mdash;
              no fine-tuning required.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <span className="font-serif text-base">æthena</span> · your AI co-scientist
      </footer>
    </div>
  );
};

export default Landing;
