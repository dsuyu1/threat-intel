export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getDb, findings } from "@ti/db";
import { and, desc, sql } from "drizzle-orm";
import { toIsoStringSafe } from "../../../lib/dates";
import { normalizeMitreTechniqueId } from "../../../lib/mitre";
import {
  FindingsDashboard,
  type FindingsSearchParams,
} from "../../../components/findings/FindingsDashboard";
import type { FindingCardModel } from "../../../components/FindingCard";

function isMissingColumn(err: unknown) {
  const anyErr = err as any;
  const code = String(anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code ?? "");
  if (code === "42703") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes('column "') && msg.includes("does not exist");
}

function parseTags(tagsJson: string | null): string[] {
  try {
    return tagsJson ? (JSON.parse(tagsJson) as string[]) : [];
  } catch {
    return [];
  }
}

function parseDays(value: unknown) {
  const n = Number(value ?? "");
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  return i > 0 && i <= 365 ? i : 0;
}

async function getLatestFindings(sp: FindingsSearchParams): Promise<FindingCardModel[]> {
  const db = getDb();
  const mitreId = normalizeMitreTechniqueId(sp.mitreId);
  const days = parseDays(sp.days);
  const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  const mitreCond = mitreId
    ? sql<boolean>`(',' || COALESCE(${findings.mitreIds}, '') || ',') ILIKE '%,' || ${mitreId} || ',%'`
    : null;
  const dateCond = cutoff
    ? sql<boolean>`COALESCE(${findings.publishedAt}, ${findings.createdAt}) >= ${cutoff}`
    : null;
  const where = [mitreCond, dateCond].filter(Boolean) as any[];
  const whereWithoutMitre = [dateCond].filter(Boolean) as any[];

  let rows: Array<{
    id: string;
    agent: string;
    title: string;
    summary: string | null;
    severity: string | null;
    cvssScore: any;
    cvssVector: string | null;
    epssScore?: any;
    epssPercentile?: any;
    epssUpdatedAt?: Date | null;
    cveId: string | null;
    tags: string | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    pocUrl: string | null;
    pocLevel: string | null;
    publishedAt: Date | null;
    createdAt: Date;
  }> = [];

  try {
    let q = db
      .select({
        id: findings.id,
        agent: findings.agent,
        title: findings.title,
        summary: findings.summary,
        severity: findings.severity,
        cvssScore: findings.cvssScore,
        cvssVector: findings.cvssVector,
        epssScore: findings.epssScore,
        epssPercentile: findings.epssPercentile,
        epssUpdatedAt: findings.epssUpdatedAt,
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
      .$dynamic();

    if (where.length) q = q.where(and(...where));

    rows = await q.orderBy(desc(findings.publishedAt), desc(findings.createdAt), desc(findings.id)).limit(500);
  } catch (err) {
    // If the DB is behind migrations (common in local dev), fall back to a query that doesn't reference newer columns.
    if (!isMissingColumn(err)) throw err;

    let q = db
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
      .$dynamic();

    const safeWhere = mitreId ? whereWithoutMitre : where;
    if (safeWhere.length) q = q.where(and(...safeWhere));
    rows = await q.orderBy(desc(findings.publishedAt), desc(findings.createdAt), desc(findings.id)).limit(500);
  }

  return rows.map((r) => ({
    id: r.id,
    agent: String(r.agent),
    title: r.title,
    summary: r.summary ?? null,
    severity: r.severity ? String(r.severity) : null,
    cvssScore: r.cvssScore ? String(r.cvssScore) : null,
    cvssVector: r.cvssVector ?? null,
    epssScore: (r as any).epssScore ? String((r as any).epssScore) : null,
    epssPercentile: (r as any).epssPercentile ? String((r as any).epssPercentile) : null,
    epssUpdatedAt: toIsoStringSafe((r as any).epssUpdatedAt),
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
  const rows = await getLatestFindings(sp);
  return <FindingsDashboard rows={rows} initialSearchParams={sp} />;
}
