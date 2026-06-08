export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, iocEnrichments, iocEnrichmentJobs, iocSources, iocs, kgEntities, kgRelations } from "@ti/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/Card";
import { IocDetailActions } from "../../../../../../components/iocs/IocDetailActions";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

function isMissingTable(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? "");
  return code === "42P01" || code === "42703";
}

function fmtDateTime(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stringifyPreview(v: unknown, max = 6000) {
  try {
    const s = JSON.stringify(v, null, 2);
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}\n…` : s;
  } catch {
    return "";
  }
}

export default async function IocDetailPage({
  params,
}: {
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOC</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">IOC management is available on Pro.</p>
      </div>
    );
  }

  let ioc:
    | {
        id: string;
        kind: string;
        value: string;
        normalized: string;
        tags: unknown;
        firstSeenAt: Date | null;
        lastSeenAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }
    | undefined;

  try {
    [ioc] = await db
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
      .where(and(eq(iocs.projectId, ctx.project.id), eq(iocs.id, p.id)))
      .limit(1);
  } catch (err) {
    if (isMissingTable(err)) {
      return (
        <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
          <Link href={`/p/${p.projectSlug}/iocs`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
            ← IOCs
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

  if (!ioc) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">IOC not found</h1>
        <Link href={`/p/${p.projectSlug}/iocs`} className="mt-4 inline-flex text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Back to IOCs
        </Link>
      </div>
    );
  }

  const sources = await db
    .select({
      id: iocSources.id,
      sourceKind: iocSources.sourceKind,
      externalId: iocSources.externalId,
      externalUrl: iocSources.externalUrl,
      confidence: iocSources.confidence,
      firstSeenAt: iocSources.firstSeenAt,
      lastSeenAt: iocSources.lastSeenAt,
      createdAt: iocSources.createdAt,
      updatedAt: iocSources.updatedAt,
    })
    .from(iocSources)
    .where(and(eq(iocSources.projectId, ctx.project.id), eq(iocSources.iocId, ioc.id)))
    .orderBy(desc(iocSources.lastSeenAt), desc(iocSources.createdAt))
    .limit(200);

  const enrichments = await db
    .select({
      id: iocEnrichments.id,
      provider: iocEnrichments.provider,
      fetchedAt: iocEnrichments.fetchedAt,
      expiresAt: iocEnrichments.expiresAt,
      error: iocEnrichments.error,
      rawJson: iocEnrichments.rawJson,
    })
    .from(iocEnrichments)
    .where(and(eq(iocEnrichments.projectId, ctx.project.id), eq(iocEnrichments.iocId, ioc.id)))
    .orderBy(desc(iocEnrichments.fetchedAt))
    .limit(50);

  const jobs = await db
    .select({
      id: iocEnrichmentJobs.id,
      provider: iocEnrichmentJobs.provider,
      status: iocEnrichmentJobs.status,
      attemptCount: iocEnrichmentJobs.attemptCount,
      startedAt: iocEnrichmentJobs.startedAt,
      finishedAt: iocEnrichmentJobs.finishedAt,
      error: iocEnrichmentJobs.error,
      createdAt: iocEnrichmentJobs.createdAt,
    })
    .from(iocEnrichmentJobs)
    .where(and(eq(iocEnrichmentJobs.projectId, ctx.project.id), eq(iocEnrichmentJobs.iocId, ioc.id)))
    .orderBy(desc(iocEnrichmentJobs.createdAt))
    .limit(50);

  const tags = Array.isArray(ioc.tags) ? ioc.tags : [];

  let mappedTechniques: Array<{ id: string; name: string | null }> = [];
  let mappedActors: Array<{ id: string; name: string | null }> = [];

  try {
    const techEnt = alias(kgEntities, "tech_ent");
    const actorEnt = alias(kgEntities, "actor_ent");
    const strength = sql<number>`(${kgRelations.support} * ${kgRelations.confidence})`;

    const techniques = await db
      .select({
        id: kgRelations.toId,
        name: techEnt.name,
      })
      .from(kgRelations)
      .leftJoin(techEnt, and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId)))
      .where(
        and(
          eq(kgRelations.type, "ioc_indicates_technique"),
          eq(kgRelations.fromKind, "ioc"),
          eq(kgRelations.fromId, ioc.id),
          eq(kgRelations.toKind, "technique")
        )
      )
      .orderBy(desc(strength), desc(kgRelations.lastSeen))
      .limit(30);

    const actors = await db
      .select({
        id: kgRelations.toId,
        name: actorEnt.name,
      })
      .from(kgRelations)
      .leftJoin(actorEnt, and(eq(actorEnt.kind, "actor"), eq(actorEnt.entityId, kgRelations.toId)))
      .where(
        and(
          eq(kgRelations.type, "ioc_indicates_actor"),
          eq(kgRelations.fromKind, "ioc"),
          eq(kgRelations.fromId, ioc.id),
          eq(kgRelations.toKind, "actor")
        )
      )
      .orderBy(desc(strength), desc(kgRelations.lastSeen))
      .limit(30);

    mappedTechniques = techniques.map((t) => ({ id: String(t.id), name: t.name ? String(t.name) : null }));
    mappedActors = actors.map((a) => ({ id: String(a.id), name: a.name ? String(a.name) : null }));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/p/${p.projectSlug}/iocs`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← IOCs
        </Link>
        <Link href={`/p/${p.projectSlug}/iocs/settings`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          Settings
        </Link>
      </div>

      <header className="space-y-2">
        <div className="text-xs text-zinc-500 uppercase tracking-wide">Indicator</div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 break-words">{ioc.value}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">{ioc.kind}</span>
          <span className="text-zinc-400">•</span>
          <span className="tabular-nums">normalized: {ioc.normalized}</span>
          <span className="text-zinc-400">•</span>
          <span className="tabular-nums">last seen: {fmtDateTime(ioc.lastSeenAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tags.length ? (
            tags.map((t: any) => (
              <span key={String(t)} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-200">
                {String(t)}
              </span>
            ))
          ) : (
            <span className="text-xs text-zinc-500">No tags</span>
          )}
        </div>
      </header>

      <IocDetailActions
        projectSlug={p.projectSlug}
        iocId={ioc.id}
        initialTags={tags.map((t: any) => String(t))}
        techniques={mappedTechniques}
        actors={mappedActors}
      />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Sources" description={`${sources.length} source${sources.length === 1 ? "" : "s"}`} />
          <CardContent className="pt-2">
            {sources.length ? (
              <div className="space-y-3">
                {sources.map((s) => (
                  <div key={s.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.sourceKind}</div>
                        <div className="mt-1 text-[11px] text-zinc-500 break-all">{s.externalId}</div>
                        {s.externalUrl ? (
                          <a href={s.externalUrl} className="mt-1 block text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline break-all">
                            {s.externalUrl}
                          </a>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-zinc-500 tabular-nums">
                        {typeof s.confidence === "number" ? <div>conf: {Math.round(s.confidence)}</div> : null}
                        <div>last: {fmtDateTime(s.lastSeenAt)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-sm text-zinc-500">No sources recorded yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Enrichment" description={`${enrichments.length} record${enrichments.length === 1 ? "" : "s"}`} />
          <CardContent className="pt-2">
            {enrichments.length ? (
              <div className="space-y-3">
                {enrichments.map((e) => (
                  <details key={e.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-4 py-3">
                    <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{e.provider}</div>
                        <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                          fetched: {fmtDateTime(e.fetchedAt)} {e.expiresAt ? ` • expires: ${fmtDateTime(e.expiresAt)}` : ""}
                        </div>
                        {e.error ? <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{e.error}</div> : null}
                      </div>
                      <span className="text-[11px] text-zinc-500">details</span>
                    </summary>
                    <pre className="mt-3 max-h-[360px] overflow-auto text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
                      {stringifyPreview(e.rawJson) || "—"}
                    </pre>
                  </details>
                ))}
              </div>
            ) : (
              <div className="py-6 text-sm text-zinc-500">No enrichment results yet.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader title="Enrichment jobs" description={`${jobs.length} job${jobs.length === 1 ? "" : "s"} (most recent first)`} />
        <CardContent className="pt-2">
          {jobs.length ? (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Attempts</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="py-2 pr-4">{j.provider}</td>
                      <td className="py-2 pr-4 tabular-nums">{j.status}</td>
                      <td className="py-2 pr-4 tabular-nums">{j.attemptCount}</td>
                      <td className="py-2 pr-4 tabular-nums">{fmtDateTime(j.createdAt)}</td>
                      <td className="py-2 pr-4 text-[11px] text-zinc-500">{j.error ? String(j.error).slice(0, 160) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-sm text-zinc-500">No jobs yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
