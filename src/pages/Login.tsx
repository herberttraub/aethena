import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function submit() {
    if (!email.trim()) {
      toast.error("Enter your email.");
      return;
    }
    if (!password) {
      toast.error("Enter your password.");
      return;
    }
    if (isRegister && password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (isRegister && password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      if (isRegister) {
        const user = await auth.register(email, password, name || undefined);
        toast.success("Account created");
        // Send fresh registrants through onboarding so we can capture profile.
        navigate(user.onboarded ? "/app" : "/onboarding", { replace: true });
      } else {
        const user = await auth.signIn(email, password);
        toast.success("Signed in");
        navigate(user.onboarded ? "/app" : "/onboarding", { replace: true });
      }
    } catch (e: any) {
      toast.error(e?.message ?? (isRegister ? "Registration failed" : "Sign-in failed"));
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
              ? "Email and a password (8+ chars). We'll set up your team and onboarding next."
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
                autoComplete="email"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Password</label>
              <Input
                className="mt-1"
                type="password"
                placeholder={isRegister ? "8+ characters" : "Your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoComplete={isRegister ? "new-password" : "current-password"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isRegister) submit();
                }}
              />
            </div>
            {isRegister && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Confirm password</label>
                <Input
                  className="mt-1"
                  type="password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              </div>
            )}
            <Button onClick={submit} className="w-full gap-1.5" disabled={busy}>
              {busy ? (isRegister ? "Creating account…" : "Signing in…") : isRegister ? "Create account" : "Sign in"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
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

export default AuthScreen;
