export const runtime = "edge";
export const dynamic = "force-static";

import { PrivacyPolicy } from "../../../components/legal/PrivacyPolicy";

const EFFECTIVE_DATE = "June 7, 2026";

export default function PrivacyPolicyPage() {
  return <PrivacyPolicy effectiveDate={EFFECTIVE_DATE} />;
}

