import Link from "next/link";

import { Card, CardContent, CardHeader } from "../ui/Card";

export function PrivacyPolicy(props: { effectiveDate: string; termsHref?: string }) {
  const termsHref = props.termsHref ?? "/terms";

  return (
    <div className="mx-auto max-w-[960px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Privacy Policy</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Effective date: {props.effectiveDate}</p>
      </header>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="1. What we collect" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="font-medium">Account data</span>: identifiers needed to authenticate and manage access (e.g.
              email, user/team IDs).
            </li>
            <li>
              <span className="font-medium">Customer content</span>: security data you upload or connect (e.g. findings,
              detections, playbooks, integrations metadata).
            </li>
            <li>
              <span className="font-medium">Usage data</span>: basic telemetry (e.g. feature usage, timestamps, performance
              metrics) to operate and improve the Service.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="2. How we use information" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <ul className="list-disc pl-5 space-y-2">
            <li>Provide and maintain the Service (including security, troubleshooting, and support).</li>
            <li>Improve product quality, reliability, and user experience.</li>
            <li>Detect abuse, prevent fraud, and protect the platform.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="3. Sharing" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>We do not sell personal information.</p>
          <p>We may share information with service providers that help us operate the Service (hosting, analytics, support).</p>
          <p>We may disclose information if required to comply with law or to protect rights and safety.</p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="4. Security" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            We use reasonable safeguards designed to protect data. However, no method of transmission or storage is 100%
            secure.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="5. Data retention" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            We retain information for as long as necessary to provide the Service, comply with legal obligations, resolve
            disputes, and enforce agreements. You may request deletion where applicable.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="6. Your choices" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <ul className="list-disc pl-5 space-y-2">
            <li>You can manage account information within the Service.</li>
            <li>You can revoke integrations and API keys you created.</li>
            <li>You can contact us to request access, correction, or deletion where required by law.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="shadow-sm dark:shadow-black/30">
        <CardHeader title="7. Changes to this Policy" />
        <CardContent className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be communicated via the Service or
            other reasonable means.
          </p>
        </CardContent>
      </Card>

      <footer className="pt-2 text-sm text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-3">
        <Link className="text-indigo-600 dark:text-indigo-400 hover:underline" href={termsHref}>
          Terms of Service
        </Link>
        <span className="text-zinc-400" aria-hidden="true">
          •
        </span>
        <a className="text-indigo-600 dark:text-indigo-400 hover:underline" href="mailto:privacy@example.com">
          Privacy contact
        </a>
      </footer>
    </div>
  );
}

