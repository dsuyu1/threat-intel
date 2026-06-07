export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { SecurityLanding } from "../components/marketing/SecurityLanding";
import { getViewerContext } from "../lib/tenancy";

function stripPort(host: string) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export default async function Home() {
  const h = await headers();
  const host = stripPort(h.get("host") ?? "");
  const isSecurityLandingHost = host === "security.damianvillarreal.com";
  const forceSecurityLanding = (process.env["SECURITY_LANDING"] ?? "") === "1";

  if (isSecurityLandingHost || forceSecurityLanding) {
    return <SecurityLanding host={host} />;
  }

  const ctx = await getViewerContext();
  redirect(`/p/${ctx.project.slug}`);
}
