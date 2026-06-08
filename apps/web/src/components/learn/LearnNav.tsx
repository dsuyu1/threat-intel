"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Fuse from "fuse.js";
import { ProBadge } from "./ProBadge";

type NavItem = { href: string; title: string; description?: string; proOnly?: boolean };
type NavSection = { section: string; items: readonly NavItem[] };

type SearchDoc = {
  href: string;
  title: string;
  section: string;
  description?: string;
  body: string;
};

function normalizeBaseHref(baseHref: string | undefined) {
  const raw = String(baseHref ?? "/learn").trim() || "/learn";
  return raw.replace(/\/+$/, "") || "/learn";
}

function mapLearnHrefToBase(href: string, baseHref: string) {
  if (!href.startsWith("/learn")) return href;
  const suffix = href.slice("/learn".length);
  return `${baseHref}${suffix}`;
}

function isActive(pathname: string, href: string, rootHref: string) {
  if (href === rootHref) return pathname === rootHref;
  return pathname === href || pathname.startsWith(href + "/");
}

export function LearnNav({ nav, baseHref }: { nav: readonly NavSection[]; baseHref?: string }) {
  const pathname = usePathname();
  const base = useMemo(() => normalizeBaseHref(baseHref), [baseHref]);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<SearchDoc[] | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    if (docs) return;
    const ac = new AbortController();
    fetch("/learn/search-index.json", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => ac.abort();
  }, [docs, query]);

  const fuse = useMemo(() => {
    if (!docs) return null;
    return new Fuse(docs, {
      includeScore: true,
      threshold: 0.35,
      keys: [
        { name: "title", weight: 0.5 },
        { name: "section", weight: 0.1 },
        { name: "description", weight: 0.2 },
        { name: "body", weight: 0.2 },
      ],
    });
  }, [docs]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q || !fuse) return [];
    return fuse.search(q).slice(0, 10).map((r) => r.item);
  }, [fuse, query]);

  const showingSearch = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="sr-only" htmlFor="learn-search">
          Search docs
        </label>
        <input
          id="learn-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Learn…"
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
      </div>

      {showingSearch ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Results</div>
          {results.length ? (
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.href}>
                  <Link
                    href={mapLearnHrefToBase(r.href, base)}
                    onClick={() => setQuery("")}
                    className="block rounded-xl border border-transparent px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{r.section}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : docs ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No matches.</div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</div>
          )}
        </div>
      ) : (
        <nav aria-label="Learn navigation" className="space-y-4">
          {nav.map((section) => (
            <div key={section.section} className="space-y-2">
              <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500">{section.section}</div>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const href = mapLearnHrefToBase(item.href, base);
                  const active = isActive(pathname, href, base);
                  return (
                    <li key={item.href}>
                      <Link
                        href={href}
                        className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-black/5 dark:bg-white/5 text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                        {item.proOnly ? <ProBadge /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
