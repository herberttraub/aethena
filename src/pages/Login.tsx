import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/SiteHeader";
import { auth } from "@/lib/auth";
import { toast } from "sonner";

interface Props {
  mode?: "login" | "register";
}

const AuthScreen = ({ mode = "login" }: Props) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  function withEmail() {
    setBusy(true);
    try {
      auth.signInWithEmail(email, name || undefined);
      toast.success(isRegister ? "Account created" : "Signed in");
      navigate("/app", { replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't sign you in");
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    setBusy(true);
    try {
      await auth.mockGoogleLogin();
      toast.success("Signed in with Google");
      navigate("/app", { replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 flex items-center">
        <section className="mx-auto w-full max-w-md px-6 py-12">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to home
          </Link>
          <h1
            className="text-4xl text-foreground"
            style={{ fontFamily: '"DM Serif Display", serif' }}
          >
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isRegister
              ? "Just an email — your team's plans and corrections are keyed to it."
              : "Sign in to pick up where your team left off."}
          </p>

          <div className="mt-8 lab-card p-5 space-y-3">
            {isRegister && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Name (optional)</label>
                <Input
                  className="mt-1"
                  placeholder="Dr. Jane Carter"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
              <Input
                className="mt-1"
                type="email"
                placeholder="you@lab.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email) withEmail();
                }}
              />
            </div>
            <Button onClick={withEmail} className="w-full gap-1.5" disabled={busy || !email.trim()}>
              {isRegister ? "Create account" : "Sign in"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.15em]">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={withGoogle}
              disabled={busy}
            >
              <GoogleIcon />
              Continue with Google
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Google sign-in is currently a stub — drop in your Google client_id (see <code className="font-mono">src/lib/auth.ts</code>) to wire real OAuth.
            </p>
          </div>

          <p className="text-xs text-muted-foreground text-center mt-6">
            {isRegister ? (
              <>Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link></>
            ) : (
              <>New here? <Link to="/register" className="text-primary hover:underline">Create an account</Link></>
            )}
          </p>
        </section>
      </main>
    </div>
  );
};

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285f4" d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.868h5.382a4.604 4.604 0 0 1-1.998 3.022v2.51h3.232c1.891-1.741 2.984-4.305 2.984-7.355z"/>
      <path fill="#34a853" d="M12 22c2.7 0 4.964-.895 6.616-2.418l-3.232-2.51c-.895.6-2.04.955-3.384.955-2.604 0-4.808-1.759-5.595-4.122H3.064v2.59A9.996 9.996 0 0 0 12 22z"/>
      <path fill="#fbbc05" d="M6.405 13.905a5.99 5.99 0 0 1 0-3.81V7.504H3.064a9.996 9.996 0 0 0 0 8.991l3.341-2.59z"/>
      <path fill="#ea4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.495l2.868-2.868C16.96 2.99 14.696 2 12 2A9.996 9.996 0 0 0 3.064 7.504l3.341 2.591C7.192 7.736 9.396 5.977 12 5.977z"/>
    </svg>
  );
}

export default AuthScreen;
