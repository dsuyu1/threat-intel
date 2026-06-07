export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getViewerContext } from "../../lib/tenancy";

export default async function AppEntry() {
  let userId: string | null = null;
  try {
    const a = await auth();
    userId = a.userId ?? null;
  } catch {
    // Local/dev without Clerk configured.
    userId = "local";
  }
  if (!userId) redirect("/sign-in");

  const ctx = await getViewerContext();
  redirect(`/p/${ctx.project.slug}`);
}
