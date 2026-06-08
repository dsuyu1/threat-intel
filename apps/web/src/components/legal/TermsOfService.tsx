import Link from "next/link";

import { Card, CardContent, CardHeader } from "../ui/Card";

export function TermsOfService(props: { effectiveDate: string; privacyHref?: string }) {
  const privacyHref = props.privacyHref ?? "/privacy";

  return (
    <div className="mx-auto max-w-[960px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Terms of Service</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Effective date: {props.effectiveDate}</p>
      </header>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="1. Agreement" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            By accessing or using this platform (the &quot;Service&quot;), you agree to be bound by these Terms of Service (the
            &quot;Terms&quot;). If you do not agree, do not use the Service.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="2. Accounts and access" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <ul className="list-disc pl-5 space-y-2">
            <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
            <li>You must ensure your use complies with applicable law and your organization&apos;s policies.</li>
            <li>You may not attempt to bypass authentication, authorization, or rate limits.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="3. Acceptable use" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Use the Service to violate laws, regulations, or third-party rights.</li>
            <li>Upload malware or intentionally harmful content.</li>
            <li>Probe, scan, or test the vulnerability of the Service without written permission.</li>
            <li>Reverse engineer the Service except to the extent permitted by law.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="4. Security and disclaimers" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            The Service provides security intelligence and workflow tooling, but it does not guarantee prevention or detection
            of incidents. Outputs may be incomplete, stale, or inaccurate.
          </p>
          <p>
            You are responsible for validating actions, detections, and operational decisions before deployment in your
            environment.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="5. Fees (if applicable)" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            If the Service is provided on a paid plan, fees, billing cadence, and refund terms are described in your order
            form or subscription page. Taxes may apply.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="6. Termination" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            We may suspend or terminate access to the Service if we reasonably believe you violated these Terms or if needed
            to protect the Service or other users.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="7. Limitation of liability" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            To the maximum extent permitted by law, the Service is provided &quot;as is&quot; and &quot;as available.&quot; In no event will we
            be liable for indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or
            business interruption.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="8. Changes to these Terms" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            We may update these Terms from time to time. Material changes will be communicated via the Service or other
            reasonable means.
          </p>
        </CardContent>
      </Card>

      <footer className="pt-2 text-sm text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-3">
        <Link className="text-indigo-600 dark:text-indigo-400 hover:underline" href={privacyHref}>
          Privacy Policy
        </Link>
        <span className="text-zinc-400" aria-hidden="true">
          •
        </span>
        <a className="text-indigo-600 dark:text-indigo-400 hover:underline" href="mailto:support@example.com">
          Contact
        </a>
      </footer>
    </div>
  );
}

