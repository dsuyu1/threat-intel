import "server-only";

import { getDb, users } from "@ti/db";
import { eq } from "drizzle-orm";

export async function getUserTierById(userId: string): Promise<string> {
  const id = String(userId ?? "").trim();
  if (!id) return "free";
  const db = getDb();
  const [row] = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row?.tier ? String(row.tier) : "free";
}

