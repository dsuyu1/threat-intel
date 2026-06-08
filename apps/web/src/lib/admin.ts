import "server-only";

import type { ViewerContext } from "./tenancy";

function parseCsv(value: string | undefined) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSuperAdmin(ctx: ViewerContext) {
  const allowUserIds = new Set(parseCsv(process.env["TI_SUPERADMIN_USER_IDS"]));
  if (allowUserIds.has(ctx.user.id)) return true;

  const clerkId = ctx.clerk.userId ?? "";
  const allowClerkIds = new Set(parseCsv(process.env["TI_SUPERADMIN_CLERK_IDS"]));
  if (clerkId && allowClerkIds.has(clerkId)) return true;

  if (process.env["TI_SUPERADMIN_LOCAL"] === "1" && process.env.NODE_ENV !== "production") return true;

  return false;
}

