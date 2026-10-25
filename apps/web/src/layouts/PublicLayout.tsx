import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/cn";
import { demoAccountShort, realAccountShort, siteHost } from "@/lib/branding";

const sectionNav = [
  { to: "/#contracts", label: "Contracts" },
  { to: "/#how", label: "How it works" },
  { to: "/#tools", label: "Tools" },
  { to: "/#faq", label: "FAQ" },
];

export function PublicSite({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const hasStickyCta = pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, hash]);

  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return (
    <div className="min-h-svh text-paper sbb-glow">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.07] bg-ink-2/85 backdrop-blur-md md:sticky">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav
            className="hidden items-center gap-7 text-sm font-medium text-mist md:flex"
            aria-label="Primary"
          >
            {sectionNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="no-underline hover:text-paper"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden px-2 text-sm font-semibold text-paper/90 no-underline hover:text-paper sm:inline"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="inline-flex h-10 items-center rounded-xl bg-signal-strong px-4 text-sm font-semibold text-white no-underline shadow-[0_10px_20px_-8px_rgb(59_130_246_/_0.6)] hover:bg-signal-hover"
            >
              Get started
            </Link>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-paper hover:bg-surface-2 md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                {menuOpen ? (
                  <path d="M6 6l12 12M18 6 6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav
            className="absolute inset-x-0 top-full border-t border-line bg-ink-2/95 px-4 py-3 shadow-2xl backdrop-blur-md md:hidden"
            aria-label="Mobile"
          >
            <div className="mx-auto flex max-w-6xl flex-col">
              {sectionNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex min-h-11 items-center text-sm font-medium text-mist no-underline hover:text-paper"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                to="/login"
                className="flex min-h-11 items-center text-sm font-semibold text-paper no-underline sm:hidden"
              >
                Log in
              </Link>
            </div>
          </nav>
        ) : null}
      </header>
      <div className={pathname === "/" ? undefined : "pt-16 md:pt-0"}>
        {children}
      </div>
      <footer
        className={cn(
          "border-t border-line bg-ink-3",
          hasStickyCta && "pb-24 md:pb-0",
        )}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-sm text-mist">
              Digit contracts on live market ticks, with clearly separated{" "}
              {demoAccountShort()} and {realAccountShort()} workspaces.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterColumn title="Explore">
              {sectionNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="text-mist no-underline hover:text-paper"
                >
                  {item.label}
                </Link>
              ))}
            </FooterColumn>
            <FooterColumn title="Account">
              <NavLink to="/login" className={footerLink}>
                Log in
              </NavLink>
              <NavLink to="/register" className={footerLink}>
                Get started
              </NavLink>
            </FooterColumn>
            <FooterColumn title="Site">
              <NavLink to="/" end className={footerLink}>
                Home
              </NavLink>
              <NavLink to="/disclosure" className={footerLink}>
                Disclosure
              </NavLink>
            </FooterColumn>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-mist">
            © {new Date().getFullYear()} SmartBaseBinary · {siteHost()}. Trading
            involves risk of loss. No guaranteed profits.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-paper">
        {title}
      </p>
      <div className="mt-3 flex flex-col gap-2 text-sm">{children}</div>
    </div>
  );
}

function footerLink({ isActive }: { isActive: boolean }) {
  return cn(
    "text-mist no-underline hover:text-paper",
    isActive && "text-signal",
  );
}

export function PublicLayout() {
  return (
    <PublicSite>
      <Outlet />
    </PublicSite>
  );
}
