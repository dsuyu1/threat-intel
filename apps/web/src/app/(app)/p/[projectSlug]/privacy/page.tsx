export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getViewerContext } from "../../../../../lib/tenancy";
import { PrivacyPolicy } from "../../../../../components/legal/PrivacyPolicy";

const EFFECTIVE_DATE = "June 7, 2026";

export default async function ProjectPrivacyPolicyPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  await getViewerContext({ projectSlug });
  return <PrivacyPolicy effectiveDate={EFFECTIVE_DATE} termsHref={`/p/${projectSlug}/terms`} />;
}

