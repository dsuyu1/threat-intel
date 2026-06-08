import { findings, getDb, projectFindingStackMatches, userStack, normalizeTechString } from "@ti/db";
import { eq, isNotNull } from "drizzle-orm";

function safeJsonParse(value: string | null): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getNvdEnglishDescription(rawData: string | null): string | null {
  const parsed = safeJsonParse(rawData);
  const descriptions = parsed?.descriptions;
  if (!Array.isArray(descriptions)) return null;
  const en = descriptions.find((d: any) => d && d.lang === "en" && typeof d.value === "string")?.value;
  return typeof en === "string" && en.trim() ? en.trim() : null;
}

function tokenMatchScore(params: { hayTokens: Set<string>; needle: string }) {
  const toks = normalizeTechString(params.needle).split(" ").filter(Boolean);
  if (toks.length === 0) return 0;
  let hit = 0;
  for (const t of toks) if (params.hayTokens.has(t)) hit++;
  return hit / toks.length;
}

export async function upsertProjectFindingStackMatchesForFindingId(db: ReturnType<typeof getDb>, findingId: string) {
  // Only meaningful for CVE-linked findings.
  const [finding] = await db
    .select({
      id: findings.id,
      cveId: findings.cveId,
      title: findings.title,
      summary: findings.summary,
      rawData: findings.rawData,
    })
    .from(findings)
    .where(eq(findings.id, findingId))
    .limit(1);

  if (!finding?.cveId) return;

  const desc = getNvdEnglishDescription(finding.rawData);
  const hay = [finding.title, finding.summary, desc, finding.cveId].filter(Boolean).join(" ");
  const hayNorm = normalizeTechString(hay);
  if (!hayNorm) return;
  const hayTokens = new Set(hayNorm.split(" ").filter(Boolean));

  // Pull project stacks (dedupe by technology per project).
  const stackRows = await db
    .select({
      projectId: userStack.projectId,
      technology: userStack.technology,
      versionRange: userStack.versionRange,
    })
    .from(userStack)
    .where(isNotNull(userStack.projectId))
    .limit(5000);

  if (!stackRows.length) return;

  const dedup = new Map<string, { projectId: string; technology: string; versionRange: string | null }>();
  for (const r of stackRows) {
    const tech = String(r.technology ?? "").trim();
    if (!tech) continue;
    const key = `${r.projectId}::${tech.toLowerCase()}`;
    if (dedup.has(key)) continue;
    dedup.set(key, {
      projectId: r.projectId,
      technology: tech,
      versionRange: r.versionRange ? String(r.versionRange) : null,
    });
  }

  const now = new Date();
  const inserts: Array<{
    projectId: string;
    findingId: string;
    technology: string;
    versionRange?: string | null;
    matchedOn?: string | null;
    createdAt?: Date;
  }> = [];

  for (const it of dedup.values()) {
    const techNorm = normalizeTechString(it.technology);
    if (!techNorm) continue;

    // Strong substring matches first.
    let matched = false;
    if (hayNorm.includes(techNorm) || techNorm.includes(hayNorm)) {
      matched = true;
    } else {
      // Fall back to token overlap for multi-word technologies.
      const score = tokenMatchScore({ hayTokens, needle: it.technology });
      matched = score >= 0.6;
    }

    if (!matched) continue;

    inserts.push({
      projectId: it.projectId,
      findingId,
      technology: it.technology,
      versionRange: it.versionRange,
      matchedOn: "finding.text",
      createdAt: now,
    });
  }

  if (!inserts.length) return;

  // Upsert-ish: unique index prevents duplicates.
  await db.insert(projectFindingStackMatches).values(inserts as any).onConflictDoNothing();
}
