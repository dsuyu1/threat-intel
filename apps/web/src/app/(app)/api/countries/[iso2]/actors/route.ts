export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, kgEntities, kgRelations } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import { toIsoStringSafe } from "../../../../../../lib/dates";
import { getViewerContext } from "../../../../../../lib/tenancy";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ iso2: string }> }
) {
  try {
    await getViewerContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { iso2: rawIso2 } = await params;
  const iso2 = rawIso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return NextResponse.json({ actors: [] }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({
      actorId: kgRelations.fromId,
      name: kgEntities.name,
      support: kgRelations.support,
      confidence: kgRelations.confidence,
      lastSeen: kgRelations.lastSeen,
    })
    .from(kgRelations)
    .leftJoin(
      kgEntities,
      and(eq(kgEntities.kind, "actor"), eq(kgEntities.entityId, kgRelations.fromId))
    )
    .where(
      and(
        eq(kgRelations.type, "actor_origin_country"),
        eq(kgRelations.fromKind, "actor"),
        eq(kgRelations.toKind, "country"),
        eq(kgRelations.toId, iso2)
      )
    )
    .orderBy(desc(kgRelations.support))
    .limit(25);

  return NextResponse.json({
    actors: rows.map((r) => ({
      actorId: r.actorId,
      name: r.name ?? r.actorId,
      support: r.support ?? 0,
      confidence: r.confidence ?? 0,
      lastSeen: toIsoStringSafe(r.lastSeen),
    })),
  });
}
