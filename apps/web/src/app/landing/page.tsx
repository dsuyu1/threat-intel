export const runtime = "edge";
export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { SecurityLanding } from "../../components/marketing/SecurityLanding";

export default async function LandingPage() {
  const h = await headers();
  const host = h.get("host");
  return <SecurityLanding host={host} />;
}
