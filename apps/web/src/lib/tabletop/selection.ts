function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export function injectCountForDuration(durationMinutes: number) {
  const d = clampInt(durationMinutes, 30, 480);
  if (d <= 100) return 5;
  if (d <= 160) return 6;
  return 8;
}

export function tPlusSchedule(durationMinutes: number, injectCount: number): number[] {
  const d = clampInt(durationMinutes, 30, 480);
  const n = clampInt(injectCount, 1, 12);
  const step = Math.max(5, Math.round(d / (n + 1)));
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(step * i);
  return out;
}

export function dedupePreserveOrder<T>(items: T[]) {
  const out: T[] = [];
  const seen = new Set<any>();
  for (const x of items) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export function pickTechniqueChain(params: {
  injectCount: number;
  gapTechniqueIds: string[];
  actorTechniqueIds: string[];
  recentTechniqueIds?: string[];
}) {
  const n = clampInt(params.injectCount, 1, 12);
  const recent = new Set((params.recentTechniqueIds ?? []).filter(Boolean));

  const preferred = dedupePreserveOrder(params.gapTechniqueIds.filter(Boolean));
  const secondary = dedupePreserveOrder(params.actorTechniqueIds.filter(Boolean));

  const out: string[] = [];
  for (const list of [preferred, secondary]) {
    for (const id of list) {
      if (out.length >= n) break;
      if (recent.has(id)) continue;
      if (!out.includes(id)) out.push(id);
    }
  }

  // If we couldn't avoid repeats, fill remaining slots with any unique technique ids.
  if (out.length < n) {
    for (const id of dedupePreserveOrder([...preferred, ...secondary])) {
      if (out.length >= n) break;
      if (!out.includes(id)) out.push(id);
    }
  }

  return out.slice(0, n);
}

export type ActorCandidate = {
  actorId: string;
  actorName: string;
  usesTechniques: string[];
  exploitsCves: string[];
  targetsSectors: string[];
};

export function pickActor(params: {
  candidates: ActorCandidate[];
  gapTechniqueIds: string[];
  gapCveIds: string[];
  projectSector?: string | null;
  recentActorScenarioPairs?: Array<{ actorId: string; scenarioType: string }>;
  scenarioType: string;
}) {
  const gapTech = new Set(params.gapTechniqueIds.filter(Boolean));
  const gapCves = new Set(params.gapCveIds.filter(Boolean));
  const sector = String(params.projectSector ?? "").trim().toLowerCase();
  const recentPairs = new Set(
    (params.recentActorScenarioPairs ?? []).map((p) => `${p.actorId}::${p.scenarioType}`)
  );

  let best: { actor: ActorCandidate; score: number } | null = null;

  for (const a of params.candidates) {
    const techOverlap = a.usesTechniques.filter((t) => gapTech.has(t)).length;
    const cveOverlap = a.exploitsCves.filter((c) => gapCves.has(c)).length;
    const sectorBoost = sector && a.targetsSectors.some((s) => String(s).toLowerCase() === sector) ? 1.25 : 0;
    const recentPenalty = recentPairs.has(`${a.actorId}::${params.scenarioType}`) ? 2.5 : 0;

    const score = techOverlap * 3 + cveOverlap * 4 + sectorBoost - recentPenalty;
    if (!best || score > best.score || (score === best.score && a.actorId < best.actor.actorId)) {
      best = { actor: a, score };
    }
  }

  return best?.actor ?? null;
}

export function pickInitialAccess(params: {
  gapCveIds: string[];
  actorCveIds: string[];
  stackTechs: Array<{ technology: string; versionRange?: string | null }>;
}) {
  const gap = dedupePreserveOrder(params.gapCveIds.filter(Boolean));
  const actor = new Set(params.actorCveIds.filter(Boolean));

  const cve = gap.find((c) => actor.has(c)) ?? gap[0] ?? (params.actorCveIds[0] ?? null);
  const stack = params.stackTechs[0] ?? null;
  return { cveId: cve ? String(cve) : null, stackTech: stack };
}

