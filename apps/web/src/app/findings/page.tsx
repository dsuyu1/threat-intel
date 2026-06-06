export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, findings } from "@ti/db";
import { desc } from "drizzle-orm";
import { toIsoStringSafe } from "../../lib/dates";
import {
  FindingsDashboard,
  type FindingsSearchParams,
} from "../../components/findings/FindingsDashboard";
import type { FindingCardModel } from "../../components/FindingCard";

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? (JSON.parse(tagsJson) as string[]) : [];
  } catch {
    return [];
  }
}

async function getLatestFindings(): Promise<FindingCardModel[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: findings.id,
      agent: findings.agent,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      cveId: findings.cveId,
      tags: findings.tags,
      sourceUrl: findings.sourceUrl,
      sourceTitle: findings.sourceTitle,
      pocUrl: findings.pocUrl,
      pocLevel: findings.pocLevel,
      publishedAt: findings.publishedAt,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .orderBy(desc(findings.publishedAt), desc(findings.createdAt), desc(findings.id))
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    agent: String(r.agent),
    title: r.title,
    summary: r.summary ?? null,
    severity: r.severity ? String(r.severity) : null,
    cvssScore: r.cvssScore ? String(r.cvssScore) : null,
    cvssVector: r.cvssVector ?? null,
    cveId: r.cveId ?? null,
    tags: parseTags(r.tags),
    sourceUrl: r.sourceUrl ?? null,
    sourceTitle: r.sourceTitle ?? null,
    pocUrl: r.pocUrl ?? null,
    pocLevel: r.pocLevel ? String(r.pocLevel) : null,
    publishedAt: toIsoStringSafe(r.publishedAt),
    createdAt: toIsoStringSafe(r.createdAt) ?? new Date().toISOString(),
  }));
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<FindingsSearchParams>;
}) {
  const sp = await searchParams;
  const rows = await getLatestFindings();
  return <FindingsDashboard rows={rows} initialSearchParams={sp} />;
}

