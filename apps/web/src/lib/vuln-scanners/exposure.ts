import "server-only";

import { getDb, vulnScannerConnections, vulnScannerCveExposures } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { toIsoStringSafe } from "../dates";

type Db = ReturnType<typeof getDb>;

function safeJsonParse(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export type ProjectCveExposure = {
  connection: { id: string; name: string; kind: string; lastSyncedAtIso: string | null } | null;
  exposure: {
    affectedHostCount: number;
    lastSeenAtIso: string | null;
    computedAtIso: string | null;
    sampleHosts: Array<{ hostname: string | null; ipv4: string | null; lastSeenAt: string | null }>;
  } | null;
};

export async function getProjectCveExposure(params: { projectId: string; cveId: string; db?: Db }): Promise<ProjectCveExposure> {
  const db = params.db ?? getDb();

  try {
    const [conn] = await db
      .select({
        id: vulnScannerConnections.id,
        name: vulnScannerConnections.name,
        kind: vulnScannerConnections.kind,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
        updatedAt: vulnScannerConnections.updatedAt,
      })
      .from(vulnScannerConnections)
      .where(and(eq(vulnScannerConnections.projectId, params.projectId), eq(vulnScannerConnections.enabled, true)))
      .orderBy(desc(vulnScannerConnections.lastSyncedAt), desc(vulnScannerConnections.updatedAt))
      .limit(1);

    if (!conn?.id) return { connection: null, exposure: null };

    const [row] = await db
      .select({
        affectedHostCount: vulnScannerCveExposures.affectedHostCount,
        lastSeenAt: vulnScannerCveExposures.lastSeenAt,
        computedAt: vulnScannerCveExposures.computedAt,
        sampleHostsJson: vulnScannerCveExposures.sampleHostsJson,
      })
      .from(vulnScannerCveExposures)
      .where(
        and(
          eq(vulnScannerCveExposures.projectId, params.projectId),
          eq(vulnScannerCveExposures.connectionId, conn.id),
          eq(vulnScannerCveExposures.cveId, params.cveId)
        )
      )
      .limit(1);

    const sampleHosts = (safeJsonParse(row?.sampleHostsJson) ?? []) as any[];

    return {
      connection: {
        id: conn.id,
        name: conn.name,
        kind: String(conn.kind ?? ""),
        lastSyncedAtIso: toIsoStringSafe(conn.lastSyncedAt),
      },
      exposure: row
        ? {
            affectedHostCount: Number(row.affectedHostCount ?? 0),
            lastSeenAtIso: toIsoStringSafe(row.lastSeenAt),
            computedAtIso: toIsoStringSafe(row.computedAt),
            sampleHosts: Array.isArray(sampleHosts)
              ? sampleHosts
                  .slice(0, 10)
                  .map((h) => ({
                    hostname: h?.hostname != null ? String(h.hostname) : null,
                    ipv4: h?.ipv4 != null ? String(h.ipv4) : null,
                    lastSeenAt: h?.lastSeenAt != null ? String(h.lastSeenAt) : null,
                  }))
              : [],
          }
        : null,
    };
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return { connection: null, exposure: null };
    throw err;
  }
}

