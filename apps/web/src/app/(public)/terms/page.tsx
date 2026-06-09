export const runtime = "edge";
export const dynamic = "force-static";

import { TermsOfService } from "../../../components/legal/TermsOfService";

const EFFECTIVE_DATE = "June 7, 2026";

export default function TermsOfServicePage() {
  return <TermsOfService effectiveDate={EFFECTIVE_DATE} />;
}

