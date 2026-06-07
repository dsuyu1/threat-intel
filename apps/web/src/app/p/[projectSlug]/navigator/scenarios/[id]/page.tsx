export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, kgEntities, kgRelations, navigatorActions, navigatorConfigs, navigatorScenarios } from "@ti/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { JourneyMap } from "../../../../../../components/navigator/JourneyMap";
import { ScenarioActions } from "../../../../../../components/navigator/ScenarioActions";
import { ScenarioValidationSelect } from "../../../../../../components/navigator/ScenarioValidationSelect";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { scoreBand, type NavigatorRiskAppetite } from "../../../../../../lib/navigator";
import { fixText } from "../../../../../../lib/text";
import { getViewerContext } from "../../../../../../lib/tenancy";

const ATTACK_TACTIC_ORDER = [
  "reconnaissance",
  "resource-development",
  "initial-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "lateral-movement",
  "collection",
  "command-and-control",
  "exfiltration",
  "impact",
] as const;

type AttackTactic = (typeof ATTACK_TACTIC_ORDER)[number];

function getTechniqueTacticsFromAttributes(attrs: unknown): AttackTactic[] {
  const arr = (attrs as any)?.tactics;
  if (!Array.isArray(arr)) return [];
  const set = new Set<AttackTactic>();
  for (const v of arr) {
    if ((ATTACK_TACTIC_ORDER as readonly string[]).includes(String(v))) set.add(String(v) as AttackTactic);
  }
  return Array.from(set);
}

function pickPrimaryTactic(tactics: AttackTactic[]): AttackTactic | null {
  for (const t of ATTACK_TACTIC_ORDER) if (tactics.includes(t)) return t;
  return tactics[0] ?? null;
}

function factorLabel(key: string) {
  if (key === "actor_relevance") return "Actor relevance";
  if (key === "relation_strength") return "Evidence strength";
  if (key === "stack_match") return "Stack match";
  return key;
}

function validationPack(params: { scenarioType: string; primaryTactic: string | null }) {
  const t = params.primaryTactic ?? "";
  const common = [
    "Confirm log sources exist and are retained (EDR, identity, email, proxy, DNS, firewall).",
    "Check detection coverage for the core behavior and related tactics.",
    "Confirm triage playbook + escalation path; define what \"good\" looks like.",
  ];

  if (params.scenarioType === "cve") {
    return [
      "Verify asset inventory: do we run the affected product/version anywhere?",
      "Confirm patch/mitigation status (including compensating controls like WAF/IDS rules).",
      "Hunt for exploitation signals around external-facing surfaces (web, VPN, email).",
      ...common,
      "Optional safe test: validate scanners and configuration checks catch the vulnerable surface (no exploitation).",
    ];
  }

  if (t === "credential-access") {
    return [
      "Verify identity telemetry (IdP, AD, MFA) is centralized and alerting.",
      "Check EDR coverage for credential dumping / token theft patterns.",
      ...common,
      "Optional safe test: run benign credential-access detection validation in a lab or test endpoint.",
    ];
  }

  if (t === "lateral-movement") {
    return [
      "Verify Windows auth + SMB/RDP/WinRM logs are collected and searchable.",
      "Check segmentation and admin tiering assumptions; validate \"east-west\" visibility.",
      ...common,
      "Optional safe test: validate detections on approved remote admin tooling.",
    ];
  }

  if (t === "command-and-control") {
    return [
      "Verify DNS + firewall/proxy telemetry is collected for endpoints and servers.",
      "Validate detections for anomalous beaconing / suspicious domains.",
      ...common,
      "Optional safe test: validate alerting on known benign test domains.",
    ];
  }

  return [
    "Validate detections and telemetry for this technique/tactic.",
    ...common,
    "Optional safe test: run a benign command sequence to ensure logs and alerts fire (no destructive actions).",
  ];
}

export default async function NavigatorScenarioPage({
  params,
}: {
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const { id, projectSlug } = await params;
  const db = getDb();
  const ctx = await getViewerContext({ projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Navigator</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Navigator is available on Pro.</p>
      </div>
    );
  }

  const [cfg] = await db
    .select({ riskAppetite: navigatorConfigs.riskAppetite })
    .from(navigatorConfigs)
    .where(eq(navigatorConfigs.projectId, ctx.project.id))
    .limit(1);
  const appetite = (cfg?.riskAppetite ?? "balanced") as NavigatorRiskAppetite;

  const [scenario] = await db
    .select({
      id: navigatorScenarios.id,
      scenarioType: navigatorScenarios.scenarioType,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      score: navigatorScenarios.score,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      primaryTactic: navigatorScenarios.primaryTactic,
      tactics: navigatorScenarios.tactics,
      whyJson: navigatorScenarios.whyJson,
      evidenceJson: navigatorScenarios.evidenceJson,
      attributes: navigatorScenarios.attributes,
      validationStatus: navigatorScenarios.validationStatus,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, id), eq(navigatorScenarios.projectId, ctx.project.id)))
    .limit(1);

  if (!scenario) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Scenario not found</h1>
        <a
          href={`/p/${projectSlug}/navigator`}
          className="mt-3 inline-block text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
        >
          Back to Navigator
        </a>
      </div>
    );
  }

  const band = scoreBand(scenario.score, appetite);
  const evidenceItems = ((scenario.evidenceJson as any)?.items ?? []) as Array<{
    excerpt: string;
    url: string;
    publishedAt: string | null;
    confidence: number;
  }>;
  const why = scenario.whyJson as any;
  const top = Array.isArray(why?.topFactors) ? (why.topFactors as any[]) : [];

  // Journey map: top techniques for this actor, grouped by tactic.
  const techEnt = alias(kgEntities, "tech_ent");
  const topTech = await db
    .select({
      techniqueId: kgRelations.toId,
      techniqueName: techEnt.name,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      attributes: techEnt.attributes,
    })
    .from(kgRelations)
    .innerJoin(techEnt, and(eq(techEnt.kind, "technique"), eq(techEnt.entityId, kgRelations.toId)))
    .where(
      and(
        eq(kgRelations.type, "actor_uses_technique"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "technique"),
        eq(kgRelations.fromId, scenario.actorId)
      )
    )
    .orderBy(desc(sql`${kgRelations.support} * ${kgRelations.confidence}`), asc(kgRelations.toId))
    .limit(80);

  // Fallback: if MITRE/OSINT actor->technique relations aren't present yet, use the user's
  // generated technique scenarios for this actor.
  const scenarioTech =
    topTech.length === 0
      ? await db
          .select({
            techniqueId: navigatorScenarios.targetId,
            techniqueName: navigatorScenarios.targetName,
            primaryTactic: navigatorScenarios.primaryTactic,
            tactics: navigatorScenarios.tactics,
            score: navigatorScenarios.score,
          })
          .from(navigatorScenarios)
            .where(
              and(
              eq(navigatorScenarios.projectId, ctx.project.id),
                eq(navigatorScenarios.actorId, scenario.actorId),
                eq(navigatorScenarios.targetKind, "technique")
              )
            )
          .orderBy(desc(navigatorScenarios.score), desc(navigatorScenarios.computedAt))
          .limit(80)
      : [];

  const groups = ATTACK_TACTIC_ORDER.map((t) => ({ tactic: t, items: [] as any[] }));
  const unmapped: any[] = [];
  const highlightId = scenario.targetKind === "technique" ? scenario.targetId : null;

  if (topTech.length) {
    for (const it of topTech) {
      const tactics = getTechniqueTacticsFromAttributes(it.attributes);
      const primary = pickPrimaryTactic(tactics);
      const row = {
        id: it.techniqueId,
        name: it.techniqueName,
        highlight: highlightId === it.techniqueId,
      };
      if (!primary) unmapped.push(row);
      else groups.find((g) => g.tactic === primary)!.items.push(row);
    }
  } else {
    for (const it of scenarioTech) {
      const tactics = Array.isArray(it.tactics) ? (it.tactics as unknown[]) : [];
      const inferred = pickPrimaryTactic(tactics.map(String).filter(Boolean) as AttackTactic[]);
      const primary =
        it.primaryTactic && (ATTACK_TACTIC_ORDER as readonly string[]).includes(String(it.primaryTactic))
          ? (String(it.primaryTactic) as AttackTactic)
          : inferred;

      const row = {
        id: it.techniqueId,
        name: it.techniqueName ?? it.techniqueId,
        highlight: highlightId === it.techniqueId,
      };
      if (!primary) unmapped.push(row);
      else groups.find((g) => g.tactic === primary)!.items.push(row);
    }
  }

  const journeyGroups = [
    ...groups.filter((g) => g.items.length > 0),
    ...(unmapped.length ? [{ tactic: "unmapped", items: unmapped }] : []),
  ];

  // Mitigations for technique scenarios
  const mitigations: Array<{ id: string; name: string; description: string | null }> = [];
  if (scenario.targetKind === "technique") {
    const t2m = alias(kgRelations, "t2m");
    const mitEnt = alias(kgEntities, "mit_ent");
    const rows = await db
      .select({ id: t2m.toId, name: mitEnt.name, description: mitEnt.description })
      .from(t2m)
      .innerJoin(mitEnt, and(eq(mitEnt.kind, "mitigation"), eq(mitEnt.entityId, t2m.toId)))
      .where(
        and(
          eq(t2m.type, "technique_mitigated_by"),
          eq(t2m.fromKind, "technique"),
          eq(t2m.toKind, "mitigation"),
          eq(t2m.fromId, scenario.targetId)
        )
      )
      .orderBy(asc(mitEnt.name))
      .limit(50);
    for (const r of rows) mitigations.push(r);
  }

  const actions = await db
    .select({
      id: navigatorActions.id,
      title: navigatorActions.title,
      status: navigatorActions.status,
      dueDate: navigatorActions.dueDate,
    })
    .from(navigatorActions)
    .where(and(eq(navigatorActions.projectId, ctx.project.id), eq(navigatorActions.scenarioId, scenario.id)))
    .orderBy(asc(navigatorActions.status), asc(navigatorActions.dueDate));

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10">
      <a href={`/p/${projectSlug}/navigator`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
        ← Back to Navigator
      </a>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {fixText(scenario.title)}
          </h1>
          {scenario.summary ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {fixText(scenario.summary)}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
              {scenario.scenarioType}{" "}
            </span>
            {scenario.scenarioType === "inferred" ? (
              <span className="rounded-full border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">
                inferred{" "}
              </span>
            ) : null}
            {scenario.primaryTactic ? (
              <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                {scenario.primaryTactic}{" "}
              </span>
            ) : null}
            <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
              {scenario.validationStatus}{" "}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="text-xs text-zinc-500">Validation status</div>
              <ScenarioValidationSelect projectSlug={projectSlug} scenarioId={scenario.id} initialStatus={scenario.validationStatus} />
            {scenario.validationStatus === "validated" ? (
              <a
                href={`/risk/${scenario.id}`}
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
              >
                Open risk entry
              </a>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{scenario.score}</div>
          <div className="mt-1 text-xs text-zinc-500 uppercase tracking-wide">{band}</div>
          <a
            href={`/p/${projectSlug}/playbooks/new?sourceKind=navigator_scenario&sourceId=${scenario.id}`}
            className="mt-3 inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm font-medium hover:opacity-95"
          >
            Generate playbook
          </a>
          <a
            href={`/api/navigator/scenarios/${scenario.id}/layer`}
            className="mt-3 inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40"
          >
            Export ATT&amp;CK layer JSON
          </a>
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Why this is high</h2>
        {top.length ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {top.slice(0, 3).map((f, idx) => (
              <div key={`${String(f.key)}:${idx}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-3">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{factorLabel(String(f.key))}</div>
                <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums">
                  {Math.round(Number(f.value ?? 0) * 100)}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No breakdown yet.</p>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Evidence</h2>
        {evidenceItems.length ? (
          <div className="mt-3 space-y-3">
            {evidenceItems.map((e, idx) => (
              <div key={idx} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-3">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{fixText(e.excerpt)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  <a href={e.url} className="hover:underline" target="_blank" rel="noreferrer">
                    source
                  </a>
                  {e.publishedAt ? <span>{new Date(e.publishedAt).toLocaleDateString()}</span> : null}
                  <span className="tabular-nums">conf {Math.round((e.confidence ?? 0) * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No evidence excerpts found for this scenario.</p>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Journey map</h2>
        <p className="mt-2 text-xs text-zinc-500">
          Tactic-sequenced techniques observed for {scenario.actorName ?? scenario.actorId}. Highlight shows this scenario.
        </p>
        {journeyGroups.length ? (
          <div className="mt-4">
            <JourneyMap groups={journeyGroups} scenarioId={scenario.id} projectSlug={projectSlug} />
          </div>
        ) : (
          <div className="mt-3 text-sm text-zinc-500 space-y-2">
            <p>No technique intel found for this actor yet.</p>
            <p>
              If you’re seeing CVE alerts, they don’t always map cleanly to ATT&amp;CK techniques. Run setup/recompute to generate technique scenarios once actor→technique data is available.
            </p>
            <a href={`/p/${projectSlug}/navigator/setup`} className="inline-flex text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              Open Navigator setup
            </a>
          </div>
        )}
      </section>

      {mitigations.length ? (
        <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Mitigations</h2>
          <div className="mt-3 space-y-2">
            {mitigations.map((m) => (
              <div key={m.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-3">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.name}</div>
                {m.description ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{m.description}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Validation pack</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300 list-disc pl-5">
          {validationPack({ scenarioType: scenario.scenarioType, primaryTactic: scenario.primaryTactic }).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Actions</h2>
          <a
            href={`/p/${projectSlug}/navigator/actions`}
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Open tracker
          </a>
        </div>
            <ScenarioActions projectSlug={projectSlug} scenarioId={scenario.id} initialActions={actions} />
      </section>
    </div>
  );
}
