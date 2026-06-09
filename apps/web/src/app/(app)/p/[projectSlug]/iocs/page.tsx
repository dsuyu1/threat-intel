export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, iocs } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { IocBulkAddForm } from "../../../../../components/iocs/IocBulkAddForm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { getViewerContext } from "../../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

const KIND_OPTIONS = ["", "ipv4", "ipv6", "domain", "url", "md5", "sha1", "sha256"] as const;

function toKind(v: string): (typeof KIND_OPTIONS)[number] {
  const s = String(v ?? "").trim().toLowerCase();
  return (KIND_OPTIONS as readonly string[]).includes(s) ? (s as any) : "";
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

export default async function IocsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const db = getDb();
  const p = await params;
  const sp = await searchParams;

  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOCs</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">IOC management is available on Pro.</p>
      </div>
    );
  }

  const q = String(pickOne(sp.q) ?? "").trim();
  const kind = toKind(String(pickOne(sp.kind) ?? ""));

  const where = [eq(iocs.projectId, ctx.project.id)];
  if (kind) where.push(eq(iocs.kind, kind as any));
  if (q) where.push(sql`(${iocs.value} ilike ${`%${q}%`} or ${iocs.normalized} ilike ${`%${q}%`})`);

  let rows: Array<{
    id: string;
    kind: string;
    value: string;
    normalized: string;
    tags: unknown;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  try {
    rows = await db
      .select({
        id: iocs.id,
        kind: iocs.kind,
        value: iocs.value,
        normalized: iocs.normalized,
        tags: iocs.tags,
        firstSeenAt: iocs.firstSeenAt,
        lastSeenAt: iocs.lastSeenAt,
        createdAt: iocs.createdAt,
        updatedAt: iocs.updatedAt,
      })
      .from(iocs)
      .where(and(...where))
      .orderBy(desc(iocs.lastSeenAt), desc(iocs.createdAt))
      .limit(500);
  } catch (err) {
    if (isMissingTable(err)) {
      return (
        <div className="max-w-[1600px] mx-auto px-6 py-10 space-y-6">
          <Link href={`/p/${p.projectSlug}`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← Project overview
          </Link>
          <Card>
            <CardHeader title="Database not migrated" description="IOC tables are missing in your current DATABASE_URL." />
            <CardContent>
              <pre className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-4 text-sm">
                pnpm db:migrate
              </pre>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Project overview
        </Link>
        <Link
          href={`/p/${p.projectSlug}/iocs/settings`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Settings
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOCs</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Store and enrich indicators of compromise (IPs, domains, URLs, hashes). Use TAXII to import feeds and enrich on demand with VirusTotal/Shodan.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader title="Add IOCs" description="Paste one per line. We’ll auto-detect type." />
          <CardContent>
            <IocBulkAddForm projectSlug={p.projectSlug} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Indicators"
            description={`${rows.length} result${rows.length === 1 ? "" : "s"} (max 500).`}
            right={
              <form method="get" className="flex items-center gap-2">
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search value"
                  className="w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <select
                  name="kind"
                  defaultValue={kind}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="">All</option>
                  {KIND_OPTIONS.filter(Boolean).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-black/40"
                >
                  Filter
                </button>
              </form>
            }
          />
          <CardContent className="pt-2">
            {rows.length ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr className="text-left">
                      <th className="py-2 pr-4">Value</th>
                      <th className="py-2 pr-4">Kind</th>
                      <th className="py-2 pr-4">Last seen</th>
                      <th className="py-2 pr-4">Tags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                    {rows.map((r) => {
                      const tags = Array.isArray(r.tags) ? r.tags : [];
                      return (
                        <tr key={r.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                          <td className="py-2 pr-4">
                            <Link href={`/p/${p.projectSlug}/iocs/${r.id}`} className="hover:underline">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.value}</span>
                              <span className="ml-2 text-xs text-zinc-500">({r.normalized})</span>
                            </Link>
                          </td>
                          <td className="py-2 pr-4">
                            <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                              {r.kind}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300 tabular-nums">
                            {fmtDate(r.lastSeenAt)}
                          </td>
                          <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">
                            {tags.length ? (
                              <span className="inline-flex items-center gap-1">
                                {tags.slice(0, 3).map((t: any) => (
                                  <span key={String(t)} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[11px]">
                                    {String(t)}
                                  </span>
                                ))}
                                {tags.length > 3 ? <span className="text-[11px] text-zinc-500">+{tags.length - 3}</span> : null}
                              </span>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-sm text-zinc-500">No IOCs yet.</div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
