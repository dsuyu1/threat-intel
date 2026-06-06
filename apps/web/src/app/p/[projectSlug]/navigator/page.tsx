export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgEntities, navigatorConfigs, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { RecomputeButton } from "../../../../components/navigator/RecomputeButton";
import { ActorCombobox } from "../../../../components/navigator/ActorCombobox";
import { MarkValidatedButton } from "../../../../components/navigator/MarkValidatedButton";
import { NavigatorScopeEditor } from "../../../../components/navigator/NavigatorScopeEditor";
import { ActorIcon } from "../../../../components/ui/ActorIcon";
import { toIsoStringSafe } from "../../../../lib/dates";
import { hasNavigatorAccess } from "../../../../lib/local-user";
import { scoreBand, type NavigatorRiskAppetite } from "../../../../lib/navigator";
import { buildHref, clamp, parsePositiveInt } from "../../../../lib/search-params";
import { fixText } from "../../../../lib/text";
import { getViewerContext } from "../../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function factorLabel(key: string) {
  if (key === "actor_relevance") return "Actor relevance";
  if (key === "relation_strength") return "Evidence strength";
  if (key === "stack_match") return "Stack match";
  return key;
}

function factorPct(value: unknown) {
  const v = Number(value ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function nf(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function paginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) out.push("ellipsis");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("ellipsis");
  out.push(total);
  return out;
}

export default async function NavigatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Navigator</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Navigator is available on Pro.</p>
      </div>
    );
  }

  const stage = pickOne(sp.stage) ?? "discover";
  const type = pickOne(sp.type) ?? "";
  const actor = pickOne(sp.actor) ?? "";
  const tactic = pickOne(sp.tactic) ?? "";
  const band = pickOne(sp.band) ?? "";
  const includeInferred = pickOne(sp.includeInferred) === "1";
  const requestedPage = parsePositiveInt(pickOne(sp.page), 1);

  const [cfg] = await db
    .select({ riskAppetite: navigatorConfigs.riskAppetite, sector: navigatorConfigs.sector })
    .from(navigatorConfigs)
    .where(eq(navigatorConfigs.projectId, ctx.project.id))
    .limit(1);

  const appetite = (cfg?.riskAppetite ?? "balanced") as NavigatorRiskAppetite;
  const sector = String(cfg?.sector ?? "all");

  const sectorRows = await db
    .select({ id: kgEntities.entityId, name: kgEntities.name })
    .from(kgEntities)
    .where(eq(kgEntities.kind, "sector"))
    .orderBy(asc(kgEntities.name))
    .limit(200);

  const sectorOptions = [{ id: "all", name: "All sectors" }, ...sectorRows];

  const actorOptions = await db
    .select({
      actorId: navigatorScenarios.actorId,
      actorName: sql<string>`min(${navigatorScenarios.actorName})`,
    })
    .from(navigatorScenarios)
    .where(eq(navigatorScenarios.projectId, ctx.project.id))
    .groupBy(navigatorScenarios.actorId)
    .orderBy(asc(sql`min(${navigatorScenarios.actorName})`))
    .limit(500);

  const tacticOptions = await db
    .select({ tactic: navigatorScenarios.primaryTactic })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.projectId, ctx.project.id), isNotNull(navigatorScenarios.primaryTactic)))
    .groupBy(navigatorScenarios.primaryTactic)
    .orderBy(asc(navigatorScenarios.primaryTactic))
    .limit(50);

  const where = [eq(navigatorScenarios.projectId, ctx.project.id)];
  if (type) where.push(eq(navigatorScenarios.scenarioType, type as any));
  if (actor) where.push(eq(navigatorScenarios.actorId, actor));
  if (tactic) where.push(eq(navigatorScenarios.primaryTactic, tactic));

  if (stage === "validate" && !includeInferred) {
    where.push(sql`${navigatorScenarios.scenarioType} != 'inferred'`);
  }

  const high = appetite === "conservative" ? 85 : appetite === "aggressive" ? 65 : 75;
  const med = appetite === "conservative" ? 60 : appetite === "aggressive" ? 40 : 50;

  const countsByStatus = await db
    .select({
      status: navigatorScenarios.validationStatus,
      count: sql<number>`count(*)`,
    })
    .from(navigatorScenarios)
    .where(eq(navigatorScenarios.projectId, ctx.project.id))
    .groupBy(navigatorScenarios.validationStatus);

  const countByStatus = new Map<string, number>();
  for (const r of countsByStatus) countByStatus.set(String(r.status), Number(r.count ?? 0));

  const discoverCount = countByStatus.get("unvalidated") ?? 0;
  const validateCount = countByStatus.get("in_progress") ?? 0;
  const mobilizeCount =
    (countByStatus.get("validated") ?? 0) + (countByStatus.get("not_applicable") ?? 0);

  const [{ prioritizeCount }] = await db
    .select({ prioritizeCount: sql<number>`count(*)` })
    .from(navigatorScenarios)
    .where(
      and(
        eq(navigatorScenarios.projectId, ctx.project.id),
        eq(navigatorScenarios.validationStatus, "unvalidated" as any),
        gte(navigatorScenarios.score, high)
      )
    );

  const [{ lastComputedAt }] = await db
    .select({ lastComputedAt: sql<Date | null>`max(${navigatorScenarios.computedAt})` })
    .from(navigatorScenarios)
    .where(eq(navigatorScenarios.projectId, ctx.project.id));
  const lastComputedAtIso = toIsoStringSafe(lastComputedAt);
  const lastComputedCaption = (() => {
    if (!lastComputedAtIso) return null;
    const d = new Date(lastComputedAtIso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  })();

  const currentHrefParams: Record<string, string | undefined> = {
    stage,
    type: type || undefined,
    actor: actor || undefined,
    tactic: tactic || undefined,
    band: band || undefined,
    includeInferred: includeInferred ? "1" : undefined,
  };

  if (band === "high") where.push(gte(navigatorScenarios.score, high));
  if (band === "medium") where.push(and(gte(navigatorScenarios.score, med), lt(navigatorScenarios.score, high)));
  if (band === "low") where.push(lt(navigatorScenarios.score, med));

  if (stage === "prioritize") {
    // Keep filters but cap for the "top of house" view.
  }

  const [{ totalMatched }] = await db
    .select({ totalMatched: sql<number>`count(*)` })
    .from(navigatorScenarios)
    .where(and(...where));

  const pageSize = 25;
  const total = Number(totalMatched ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp(requestedPage, 1, totalPages);
  const offset = (page - 1) * pageSize;

  const scenarios = await db
    .select({
      id: navigatorScenarios.id,
      scenarioType: navigatorScenarios.scenarioType,
      title: navigatorScenarios.title,
      score: navigatorScenarios.score,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      primaryTactic: navigatorScenarios.primaryTactic,
      validationStatus: navigatorScenarios.validationStatus,
      whyJson: navigatorScenarios.whyJson,
      evidenceJson: navigatorScenarios.evidenceJson,
      attributes: navigatorScenarios.attributes,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(...where))
    .orderBy(desc(navigatorScenarios.score), desc(navigatorScenarios.rawPriority), desc(navigatorScenarios.computedAt))
    .limit(pageSize)
    .offset(offset);

  type ScenarioRow = (typeof scenarios)[number];

  const shouldGroupByActor = stage === "discover" && !band && !actor;

  const groupScenariosByActor = (items: ScenarioRow[]) => {
    const map = new Map<
      string,
      { key: string; actorId: string | null; actorName: string; items: ScenarioRow[] }
    >();

    for (const s of items) {
      const key = s.actorId ?? "unknown";
      const entry = map.get(key);
      if (entry) {
        entry.items.push(s);
        continue;
      }

      map.set(key, {
        key,
        actorId: s.actorId ?? null,
        actorName: String(s.actorName ?? s.actorId ?? "Unknown actor"),
        items: [s],
      });
    }

    return Array.from(map.values()).sort((a, b) => a.actorName.localeCompare(b.actorName));
  };

  const highScenarios = shouldGroupByActor ? scenarios.filter((s) => scoreBand(s.score, appetite) === "high") : [];
  const mediumScenarios = shouldGroupByActor ? scenarios.filter((s) => scoreBand(s.score, appetite) === "medium") : [];
  const lowScenarios = shouldGroupByActor ? scenarios.filter((s) => scoreBand(s.score, appetite) === "low") : [];
  const mediumGroups = shouldGroupByActor ? groupScenariosByActor(mediumScenarios) : [];
  const lowGroups = shouldGroupByActor ? groupScenariosByActor(lowScenarios) : [];

  const renderScenarioCard = (s: ScenarioRow) => {
    const why = s.whyJson as any;
    const top = Array.isArray(why?.topFactors) ? (why.topFactors as any[]) : [];
    const factors = Array.isArray(why?.factors) ? (why.factors as any[]) : top;
    const factorByKey = new Map<string, any>();
    for (const f of factors) factorByKey.set(String((f as any)?.key ?? ""), f);

    const evidence = fixText((s.evidenceJson as any)?.items?.[0]?.excerpt as string | undefined);
    const bandLabel = scoreBand(s.score, appetite);
    const accent =
      bandLabel === "high" ? "bg-rose-500/70" : bandLabel === "medium" ? "bg-amber-500/70" : "bg-zinc-500/50";

    const validationStatus = String(s.validationStatus ?? "unvalidated");
    const validationBadge =
      validationStatus === "validated"
        ? {
            label: "validated",
            className:
              "border-emerald-300/60 dark:border-emerald-700/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200",
          }
        : validationStatus === "in_progress"
          ? {
              label: "in progress",
              className:
                "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/50 dark:bg-sky-950/20 text-sky-800 dark:text-sky-200",
            }
          : validationStatus === "not_applicable"
            ? {
                label: "n/a",
                className:
                  "border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 text-zinc-700 dark:text-zinc-300",
              }
            : null;

    const attrs = s.attributes as any;
    const stackMatchKind = attrs?.stackMatch?.kind as string | undefined;

    return (
      <a
        key={s.id}
        href={`/p/${p.projectSlug}/navigator/scenarios/${s.id}`}
        className="relative overflow-hidden block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5 hover:bg-white/80 dark:hover:bg-black/40 transition-colors"
      >
        <div aria-hidden className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex items-start gap-3">
            {s.actorId ? (
              <div className="shrink-0 pt-0.5">
                <ActorIcon seed={s.actorId} size={32} title={s.actorName ?? s.actorId} className="block" />
              </div>
            ) : null}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {fixText(s.title)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                  {s.scenarioType}{" "}
                </span>
                {s.scenarioType === "inferred" ? (
                  <span className="rounded-full border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">
                    inferred{" "}
                  </span>
                ) : null}
                {s.scenarioType === "cve" && stackMatchKind === "unknown-match" ? (
                  <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                    unmapped{" "}
                  </span>
                ) : null}
                {s.primaryTactic ? (
                  <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                    {s.primaryTactic}{" "}
                  </span>
                ) : null}
                {validationBadge ? (
                  <span className={`rounded-full border px-2 py-0.5 ${validationBadge.className}`}>
                    {validationBadge.label}{" "}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {s.score}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{bandLabel}</div>
            {validationStatus !== "validated" && validationStatus !== "not_applicable" ? (
              <div className="mt-2 flex justify-end">
                  <MarkValidatedButton projectSlug={p.projectSlug} scenarioId={s.id} validationStatus={validationStatus} />
              </div>
            ) : null}
          </div>
        </div>

        {factors.length ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {["relation_strength", "actor_relevance", "stack_match"].map((key) => {
              const f = factorByKey.get(key);
              const pct = factorPct((f as any)?.value);
              return (
                <div key={key} className="min-w-0">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="truncate">{factorLabel(key)}</span>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-900/60 dark:bg-zinc-100/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {evidence ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{evidence}</p>
        ) : (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No evidence excerpts yet.</p>
        )}
      </a>
    );
  };

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Navigator</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Turn threat-actor intelligence into a CTEM plan: scope what matters, discover likely TTPs, prioritize what to tackle first, validate with detections, then mobilize actions for your team.
          </p>
          {lastComputedCaption ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Last updated <span className="tabular-nums">{lastComputedCaption}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/p/${p.projectSlug}/navigator/setup`}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
          >
            Setup
          </a>
            <RecomputeButton projectSlug={p.projectSlug} lastUpdatedAt={lastComputedAtIso} />
        </div>
      </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          {[
            { id: "scope", label: "Scope", count: null as number | null },
            { id: "discover", label: "Discover", count: discoverCount },
            { id: "prioritize", label: "Prioritize", count: Number(prioritizeCount ?? 0) },
            { id: "validate", label: "Validate", count: validateCount },
            { id: "mobilize", label: "Mobilize", count: mobilizeCount },
          ].map((t) => (
              <a
                key={t.id}
                href={buildHref(`/p/${p.projectSlug}/navigator`, currentHrefParams, { stage: t.id })}
                className={`rounded-full px-3 py-1 border ${
                  stage === t.id
                    ? "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/60 dark:bg-sky-950/20 text-sky-800 dark:text-sky-200"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 text-zinc-700 dark:text-zinc-300 hover:bg-white/70 dark:hover:bg-black/30"
                }`}
              >
              <span>{t.label}</span>
              {typeof t.count === "number" ? (
                <span className="ml-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {nf(t.count)}
                </span>
              ) : null}
            </a>
          ))}
        <div className="ml-auto">
          <NavigatorScopeEditor projectSlug={p.projectSlug} sector={sector} riskAppetite={appetite} sectorOptions={sectorOptions} />
        </div>
      </div>

      {stage === "scope" ? (
        <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Scope summary
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Sector: <span className="text-zinc-900 dark:text-zinc-100 font-medium">{sector}</span>.{" "}
            Risk appetite: <span className="text-zinc-900 dark:text-zinc-100 font-medium">{appetite}</span>.
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Update these inputs to regenerate scenarios deterministically.
          </p>
          <a
            href={`/p/${p.projectSlug}/navigator/setup`}
            className="inline-flex mt-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
          >
            Edit setup
          </a>
        </section>
      ) : stage === "mobilize" ? (
        <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Mobilize
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Track remediation and validation work as actions.
          </p>
          <a
            href={`/p/${p.projectSlug}/navigator/actions`}
            className="inline-flex mt-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
          >
            Open action tracker
          </a>
        </section>
      ) : (
        <>
          <form
            className="mt-8 flex flex-wrap gap-3 items-end"
            method="get"
            action={`/p/${p.projectSlug}/navigator`}
          >
            <input type="hidden" name="stage" value={stage} />
            <input type="hidden" name="page" value="1" />
            <a
              href={buildHref(`/p/${p.projectSlug}/navigator`, {}, { stage })}
              className="mb-1 inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-white/80 dark:hover:bg-black/30"
            >
              Reset
            </a>
            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Scenario type
              <select
                name="type"
                className="mt-2 w-full min-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
                defaultValue={type}
              >
                <option value="">All</option>
                <option value="cve">CVE</option>
                <option value="technique">Technique</option>
                <option value="inferred">Inferred</option>
              </select>
            </label>

            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Actor
              <div className="mt-2">
                <ActorCombobox
                  name="actor"
                  defaultValue={actor}
                  options={actorOptions.map((a) => ({ id: a.actorId, label: a.actorName || a.actorId }))}
                  placeholder="All actors"
                />
              </div>
            </label>

            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Tactic
              <select
                name="tactic"
                className="mt-2 w-full min-w-[200px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
                defaultValue={tactic}
              >
                <option value="">All</option>
                {tacticOptions.map((t) => (
                  <option key={t.tactic ?? ""} value={t.tactic ?? ""}>
                    {t.tactic}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Band
              <select
                name="band"
                className="mt-2 w-full min-w-[140px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
                defaultValue={band}
              >
                <option value="">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>

            {stage === "validate" ? (
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-1">
                <input
                  type="checkbox"
                  name="includeInferred"
                  value="1"
                  defaultChecked={includeInferred}
                />
                Include inferred
              </label>
            ) : null}

            <button
              type="submit"
              className="ml-auto rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
            >
              Apply
            </button>
          </form>

          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <div className="tabular-nums">
              Showing {nf(scenarios.length)} of {nf(total)} scenarios
              {totalPages > 1 ? (
                <>
                  {" "}
                  | Page {nf(page)} / {nf(totalPages)}
                </>
              ) : null}
            </div>

            {totalPages > 1 ? (
              <nav className="flex items-center gap-1">
                <a
                  href={buildHref(`/p/${p.projectSlug}/navigator`, currentHrefParams, {
                    page: page > 1 ? String(page - 1) : undefined,
                  })}
                  className={`rounded-lg border px-2 py-1 ${
                    page > 1
                      ? "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                      : "border-zinc-200/60 dark:border-zinc-800/60 text-zinc-400 dark:text-zinc-600 pointer-events-none"
                  }`}
                  aria-disabled={page <= 1}
                >
                  Prev
                </a>

                {paginationItems(page, totalPages).map((it, idx) =>
                  it === "ellipsis" ? (
                    <span key={`e-${idx}`} className="px-2 text-zinc-400 dark:text-zinc-600">
                      ...
                    </span>
                  ) : (
                    <a
                      key={it}
                      href={buildHref(`/p/${p.projectSlug}/navigator`, currentHrefParams, {
                        page: it === 1 ? undefined : String(it),
                      })}
                      className={`rounded-lg border px-2 py-1 tabular-nums ${
                        it === page
                          ? "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/60 dark:bg-sky-950/20 text-sky-800 dark:text-sky-200"
                          : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                      }`}
                    >
                      {it}
                    </a>
                  )
                )}

                <a
                  href={buildHref(`/p/${p.projectSlug}/navigator`, currentHrefParams, {
                    page: page < totalPages ? String(page + 1) : undefined,
                  })}
                  className={`rounded-lg border px-2 py-1 ${
                    page < totalPages
                      ? "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
                      : "border-zinc-200/60 dark:border-zinc-800/60 text-zinc-400 dark:text-zinc-600 pointer-events-none"
                  }`}
                  aria-disabled={page >= totalPages}
                >
                  Next
                </a>
              </nav>
            ) : null}
          </div>

          {!scenarios.length ? (
            <div className="mt-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">No scenarios yet</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Run setup to generate scenarios from your sector and stack.
              </p>
              <a
                href={`/p/${p.projectSlug}/navigator/setup`}
                className="inline-flex mt-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
              >
                Go to setup
              </a>
            </div>
          ) : (
            <>
              {shouldGroupByActor ? (
                <div className="mt-8 space-y-6">
                  {highScenarios.length ? (
                    <section>
                      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                        <div className="uppercase tracking-wide">High</div>
                        <div className="tabular-nums">{nf(highScenarios.length)} scenarios</div>
                      </div>
                      <div className="mt-3 space-y-4">{highScenarios.map(renderScenarioCard)}</div>
                    </section>
                  ) : null}

                  {mediumGroups.length ? (
                    <section>
                      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                        <div className="uppercase tracking-wide">Medium</div>
                        <div className="tabular-nums">{nf(mediumScenarios.length)} scenarios</div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {mediumGroups.map((g) => (
                          <details
                            key={g.key}
                            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20"
                          >
                            <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-3">
                              {g.actorId ? (
                                <ActorIcon seed={g.actorId} size={24} title={g.actorName} className="shrink-0" />
                              ) : null}
                              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {g.actorName}
                              </span>
                              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                                {nf(g.items.length)}
                              </span>
                            </summary>
                            <div className="px-4 pb-4 space-y-4">{g.items.map(renderScenarioCard)}</div>
                          </details>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {lowGroups.length ? (
                    <section>
                      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                        <div className="uppercase tracking-wide">Low</div>
                        <div className="tabular-nums">{nf(lowScenarios.length)} scenarios</div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {lowGroups.map((g) => (
                          <details
                            key={g.key}
                            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20"
                          >
                            <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-3">
                              {g.actorId ? (
                                <ActorIcon seed={g.actorId} size={24} title={g.actorName} className="shrink-0" />
                              ) : null}
                              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {g.actorName}
                              </span>
                              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                                {nf(g.items.length)}
                              </span>
                            </summary>
                            <div className="px-4 pb-4 space-y-4">{g.items.map(renderScenarioCard)}</div>
                          </details>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : (
                <div className="mt-8 space-y-4">{scenarios.map(renderScenarioCard)}</div>
              )}
            </>
          )}

          {stage === "validate" ? (
            <div className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
              Inferred scenarios are excluded by default from validation KPIs; toggle &ldquo;Include inferred&rdquo;
              to review them.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
