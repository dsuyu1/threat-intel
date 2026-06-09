export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const a = await auth().catch(() => null);

  if (!a?.userId) {
    if (process.env.NODE_ENV !== "production") {
      const { getViewerContext } = await import("../lib/tenancy");
      const ctx = await getViewerContext();
      redirect(`/p/${ctx.project.slug}`);
    }
    redirect("/learn");
  }

  const { getViewerContext } = await import("../lib/tenancy");
  const ctx = await getViewerContext();
  redirect(`/p/${ctx.project.slug}`);
}
