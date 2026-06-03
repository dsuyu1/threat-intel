import { getDb, findings } from "@ti/db";
import { desc } from "drizzle-orm";
import { GlobeLoader } from "../components/GlobeLoader";
import { inferCoords } from "../lib/geo";
import type { MapFinding } from "../components/ThreatMap";

export const revalidate = 3600;

async function getMapFindings(): Promise<MapFinding[]> {
  const db = getDb();
  const rows = await db
    .select({
      id:          findings.id,
      agent:       findings.agent,
      title:       findings.title,
      summary:     findings.summary,
      severity:    findings.severity,
      cvssScore:   findings.cvssScore,
      cveId:       findings.cveId,
      tags:        findings.tags,
      publishedAt: findings.publishedAt,
    })
    .from(findings)
    .orderBy(desc(findings.publishedAt))
    .limit(200);

  return rows.map(r => ({
    ...r,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    coords:      inferCoords(r.tags, r.agent),
    href:        `/findings/${r.id}`,
  }));
}

export default async function HomePage() {
  const mapFindings = await getMapFindings();
  return <GlobeLoader findings={mapFindings} />;
}
