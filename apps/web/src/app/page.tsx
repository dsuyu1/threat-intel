export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getViewerContext } from "../lib/tenancy";

export default async function Home() {
  let ctx: Awaited<ReturnType<typeof getViewerContext>> | null = null;
  try {
    ctx = await getViewerContext();
  } catch {
    redirect("/learn");
  }
  if (!ctx) redirect("/learn");
  redirect(`/p/${ctx.project.slug}`);
}
