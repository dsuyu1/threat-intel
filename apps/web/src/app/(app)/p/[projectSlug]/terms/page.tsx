export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getViewerContext } from "../../../../../lib/tenancy";
import { TermsOfService } from "../../../../../components/legal/TermsOfService";

const EFFECTIVE_DATE = "June 7, 2026";

export default async function ProjectTermsOfServicePage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;
  await getViewerContext({ projectSlug });
  return <TermsOfService effectiveDate={EFFECTIVE_DATE} privacyHref={`/p/${projectSlug}/privacy`} />;
}

