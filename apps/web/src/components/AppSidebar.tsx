"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { PLATFORM_NAV_SECTIONS } from "../lib/platform-nav";

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
  return false;
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
  if (href === "/playbooks" || href.startsWith("/playbooks/")) return `/p/${projectSlug}${href}`;
  if (href === "/sbom" || href.startsWith("/sbom/")) return `/p/${projectSlug}${href}`;
  if (href === "/tabletop" || href.startsWith("/tabletop/")) return `/p/${projectSlug}${href}`;
  if (href === "/api-keys" || href.startsWith("/api-keys/")) return `/p/${projectSlug}${href}`;
  if (href === "/defend" || href.startsWith("/defend/")) return `/p/${projectSlug}${href}`;
  return href;
}

export function AppSidebar() {
  const pathname = usePathname();
  const projectSlug = parseProjectSlug(pathname);

  return (
    <div className="flex flex-col gap-6">
      {PLATFORM_NAV_SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-2">
          <div className="px-2">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">
              {section.label}
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {section.items.map((item) => {
              const href = projectizeHref(item.href, projectSlug);
              const active = isActivePath(pathname, href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={href}
                  className={clsx(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                    "hover:bg-black/5 dark:hover:bg-white/5",
                    active
                      ? "bg-black/5 dark:bg-white/5 text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-700 dark:text-zinc-300"
                  )}
                >
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center",
                      active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500"
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
