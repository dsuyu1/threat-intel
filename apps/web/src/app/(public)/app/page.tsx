export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getViewerContext } from "../../../lib/tenancy";

export default async function AppEntry() {
  try {
    const ctx = await getViewerContext();
    redirect(`/p/${ctx.project.slug}`);
  } catch (err) {
    const msg = String((err as any)?.message ?? "");
    if (msg.toLowerCase().includes("not authenticated")) redirect("/sign-in");
    throw err;
  }
}
