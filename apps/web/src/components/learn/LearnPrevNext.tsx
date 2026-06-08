import Link from "next/link";
import { getLearnPrevNext } from "../../content/learn/_generated/manifest";

function normalizeBaseHref(baseHref: string | undefined) {
  const raw = String(baseHref ?? "/learn").trim() || "/learn";
  return raw.replace(/\/+$/, "") || "/learn";
}

function mapLearnHrefToBase(href: string, baseHref: string) {
  if (!href.startsWith("/learn")) return href;
  const suffix = href.slice("/learn".length);
  return `${baseHref}${suffix}`;
}

export function LearnPrevNext({ href, baseHref }: { href: string; baseHref?: string }) {
  const { prev, next } = getLearnPrevNext(href);
  const base = normalizeBaseHref(baseHref);

  if (!prev && !next) return null;

  return (
    <nav className="mt-10 border-t border-zinc-200 dark:border-zinc-800 pt-6 flex items-stretch gap-4">
      {prev ? (
        <Link
          href={mapLearnHrefToBase(prev.href, base)}
          className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Previous</div>
          <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{prev.frontmatter.title}</div>
        </Link>
      ) : (
        <div className="flex-1" />
      )}

      {next ? (
        <Link
          href={mapLearnHrefToBase(next.href, base)}
          className="flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-right"
        >
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Next</div>
          <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{next.frontmatter.title}</div>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
