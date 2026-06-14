"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { PLATFORM_NAV_SECTIONS } from "../lib/platform-nav";

function normalizePath(s: string) {
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

function isPrefixOrExactMatch(pathname: string, href: string) {
  const p = normalizePath(pathname);
  const h = normalizePath(href);
  return p === h || p.startsWith(`${h}/`);
}

function findBestActiveHref(pathname: string, hrefs: string[]) {
  const p = normalizePath(pathname);

  let best: { href: string; normHref: string } | null = null;
  for (const href of hrefs) {
    const h = normalizePath(href);
    if (p === h || p.startsWith(`${h}/`)) {
      if (!best || h.length > best.normHref.length) {
        best = { href, normHref: h };
      }
    }
  }

  return best?.href ?? null;
}

function parseProjectSlug(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "p") return null;
  return parts[1] ?? null;
}

function projectizeHref(href: string, projectSlug: string | null) {
  if (!projectSlug) return href;
  if (href === "/") return `/p/${projectSlug}`;
  if (href === "/navigator" || href.startsWith("/navigator/")) return `/p/${projectSlug}${href}`;
  if (href === "/iocs" || href.startsWith("/iocs/")) return `/p/${projectSlug}${href}`;
  if (href === "/risk" || href.startsWith("/risk/")) return `/p/${projectSlug}${href}`;
  if (href === "/watchlist" || href.startsWith("/watchlist/")) return `/p/${projectSlug}${href}`;
  if (href === "/compliance" || href.startsWith("/compliance/")) return `/p/${projectSlug}${href}`;
  if (href === "/playbooks" || href.startsWith("/playbooks/")) return `/p/${projectSlug}${href}`;
  if (href === "/sbom" || href.startsWith("/sbom/")) return `/p/${projectSlug}${href}`;
  if (href === "/tabletop" || href.startsWith("/tabletop/")) return `/p/${projectSlug}${href}`;
  if (href === "/api-keys" || href.startsWith("/api-keys/")) return `/p/${projectSlug}${href}`;
  if (href === "/learn" || href.startsWith("/learn/")) return `/p/${projectSlug}${href}`;
  if (href === "/defend" || href.startsWith("/defend/")) return `/p/${projectSlug}${href}`;
  return href;
}

export function AppSidebar() {
  const pathname = usePathname();
  const projectSlug = parseProjectSlug(pathname);
  const allHrefs = PLATFORM_NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => projectizeHref(item.href, projectSlug))
  );
  const activeHref = findBestActiveHref(pathname, allHrefs);

  return (
    <div className="flex flex-col gap-6">
      {PLATFORM_NAV_SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-2">
          <div className="px-2">
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--ti-muted)]">
              {section.label}
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {section.items.map((item) => {
              const href = projectizeHref(item.href, projectSlug);
              const active =
                !!activeHref &&
                normalizePath(href) === normalizePath(activeHref) &&
                isPrefixOrExactMatch(pathname, href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={href}
                  className={clsx(
                    "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] border border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]",
                    "hover:bg-black/5 dark:hover:bg-white/5 hover:border-[color:var(--ti-border)]",
                    active
                      ? "bg-[color:var(--ti-card)] text-[color:var(--ti-fg)] border-[color:var(--ti-border)] shadow-[var(--ti-shadow-sm)]"
                      : "text-[color:var(--ti-muted)]"
                  )}
                >
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center",
                      active ? "text-[color:var(--ti-fg)]" : "text-[color:var(--ti-muted)]"
                    )}
                  >
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );
}
