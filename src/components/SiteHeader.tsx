import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "@/assets/aethena-logo.png";

export function SiteHeader() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [compact, setCompact] = useState(false);

  // Shrink the header when scrolling down past ~80px; restore on scroll up
  // or when we're back near the top. Uses requestAnimationFrame so the
  // listener never blocks scrolling.
  useEffect(() => {
    let lastY = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 40) setCompact(false);
        else if (y > 80 && y > lastY + 4) setCompact(true);
        else if (y < lastY - 4) setCompact(false);
        lastY = y;
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  function goHome(e: React.MouseEvent) {
    // Logo click → landing page (root). Lets the router handle navigation
    // normally so the existing "/" route is honored. If the landing page is
    // ever moved to a different path, only this line changes.
    e.preventDefault();
    navigate("/");
  }

  function handleNewPlan(e: React.MouseEvent) {
    e.preventDefault();
    // Force a fresh state on the New plan link even if we're already on "/app".
    navigate("/app?new=" + Date.now(), { replace: true });
  }

  return (
    <header
      className={`border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30 transition-[padding] duration-200 ${
        compact ? "py-0" : "py-0"
      }`}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between px-6 transition-[padding] duration-200 ${
          compact ? "py-1.5" : "py-3"
        }`}
      >
        <Link
          to="/"
          onClick={goHome}
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
        </nav>
      </div>
    </header>
  );
}
