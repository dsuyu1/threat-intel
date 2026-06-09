export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const a = await auth().catch(() => null);
  const publicBeta =
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "1" ||
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "true";

  if (!a?.userId) {
    if (process.env.NODE_ENV === "production" && !publicBeta) {
      // NOTE (future): once beta is over, send signed-out users to a real public landing/docs page
      // instead of the app. During beta we allow public access via NAVIGATOR_PUBLIC_BETA.
      redirect("/sign-in");
    }

    // NOTE (beta): In production we normally send signed-out users to a public landing/docs page.
    // While the product is in a public beta (no payments), we instead drop users straight into
    // the dashboard by minting a local viewer context (see NAVIGATOR_PUBLIC_BETA in tenancy.ts).
    const { getViewerContext } = await import("../lib/tenancy");
    const ctx = await getViewerContext();
    redirect(`/p/${ctx.project.slug}`);
  }

  const { getViewerContext } = await import("../lib/tenancy");
  const ctx = await getViewerContext();
  redirect(`/p/${ctx.project.slug}`);
}
