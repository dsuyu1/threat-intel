export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getViewerContext } from "../../../../lib/tenancy";

export default async function RiskComplianceRedirect() {
  const ctx = await getViewerContext();
  redirect(`/p/${ctx.project.slug}/risk/compliance`);
}

