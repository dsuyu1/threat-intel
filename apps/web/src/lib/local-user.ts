import { getDb, users } from "@ti/db";
import { eq } from "drizzle-orm";

export async function getLocalUser() {
  const db = getDb();
  const clerkId = process.env["NAVIGATOR_LOCAL_CLERK_ID"] ?? "local";
  const email = process.env["NAVIGATOR_LOCAL_EMAIL"] ?? "local@threat-intel.dev";
  const tier = (process.env["NAVIGATOR_LOCAL_TIER"] ?? "pro") === "free" ? "free" : "pro";

  const [existing] = await db
    .select({ id: users.id, tier: users.tier, email: users.email })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (existing) return existing;

  await db
    .insert(users)
    .values({
      email,
      clerkId,
      tier,
    })
    .onConflictDoNothing();

  const [created] = await db
    .select({ id: users.id, tier: users.tier, email: users.email })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!created) throw new Error("Failed to create local user");
  return created;
}

export function hasNavigatorAccess(params: { tier: string }) {
  if (process.env["NAVIGATOR_BYPASS_PRO"] === "1") return true;
  return params.tier === "pro";
}

