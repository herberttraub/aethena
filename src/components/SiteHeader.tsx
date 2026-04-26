import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { auth, type AuthUser } from "@/lib/auth";
import logo from "@/assets/aethena-logo.png";

/** Subscribe to auth state changes. We can't use useSyncExternalStore here
 * because `auth.current()` deserializes a fresh object from localStorage on
 * every call — React compares snapshots by reference, infers an infinite
 * change loop, and throws Maximum update depth. Plain useState +
 * subscription is the right pattern when the snapshot isn't stable. */
function useAuth(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(() => auth.current());
  useEffect(() => auth.onChange((u) => setUser(u)), []);
  return user;
}

export function SiteHeader() {
  const loc = useLocation();
  const navigate = useNavigate();
  const user = useAuth();
  const isAuthed = !!user;

  // Header height transitions while scrolling caused a "jelly hero" jitter
  // because compact toggled on every 4px of scroll. Use a strong hysteresis:
  // collapse only past 160px AND while scrolling down; expand only at the
  // top of the page. No state change in the middle band -> no layout reflow.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const goingDown = y > lastY + 6;
        const goingUp = y < lastY - 6;
        if (y < 24) setCompact(false);
        else if (y > 160 && goingDown) setCompact(true);
        else if (goingUp && y < 80) setCompact(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function goLogo(e: React.MouseEvent) {
    // Logo click: signed-in users land on the workspace, signed-out users
    // see the marketing page. This matches the "icon should bring me to
    // hypothesis entry" expectation once authed.
    e.preventDefault();
    navigate(isAuthed ? "/app" : "/");
  }

  function handleNewPlan(e: React.MouseEvent) {
    e.preventDefault();
    navigate("/app?new=" + Date.now(), { replace: true });
  }

  function handleSignOut() {
    auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between px-6 transition-[padding] duration-200 ${
          compact ? "py-1.5" : "py-3"
        }`}
      >
        <Link
          to={isAuthed ? "/app" : "/"}
          onClick={goLogo}
          className="flex items-center gap-3 group shrink-0"
          aria-label="aethena home"
        >
          <img
            src={logo}
            alt="aethena"
            className={`w-auto object-contain transition-[height] duration-200 ease-out ${
              compact ? "h-8" : "h-20 md:h-24"
            }`}
          />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {isAuthed && (
            <>
              <a
                href="/app"
                onClick={handleNewPlan}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                  loc.pathname.startsWith("/app") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                New plan
              </a>
              <Link
                to="/reviews"
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  loc.pathname.startsWith("/reviews") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Past plans
              </Link>
              <UserMenu user={user} onSignOut={handleSignOut} />
            </>
          )}
          {!isAuthed && (
            <>
              <Link
                to="/login"
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity ml-1"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function UserMenu({
  user,
  onSignOut,
}: {
  user: { email: string; name?: string } | null;
  onSignOut: () => void;
}) {
  if (!user) return null;
  const initial = (user.name || user.email).charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-2 grid place-items-center h-8 w-8 rounded-full bg-primary-soft text-primary-deep text-sm font-medium hover:bg-primary/20 transition-colors"
          aria-label="Account menu"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium leading-none">{user.name || "Researcher"}</div>
          <div className="text-xs text-muted-foreground leading-none mt-1 truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="gap-2 cursor-pointer">
            <UserIcon className="h-3.5 w-3.5" /> Profile &amp; preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} className="gap-2 cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
