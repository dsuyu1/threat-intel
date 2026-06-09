export const runtime = "edge";

import Link from "next/link";
import { FileSearch, Mail, ShieldAlert, Workflow } from "lucide-react";
import { FaDiscord, FaSlack } from "react-icons/fa";
import { SiJira, SiSplunk } from "react-icons/si";
import { TbBrandTeams } from "react-icons/tb";
import { Card, CardContent, CardHeader } from "../../../components/ui/Card";

const CONNECTIONS = [
  {
    title: "Jira Automation",
    description: "Create/update issues via Jira Automation incoming webhooks.",
    href: "/integrations/jira-automation",
    Icon: SiJira,
  },
  {
    title: "Slack",
    description: "Notify a Slack channel via Incoming Webhooks.",
    href: "/integrations/slack-webhooks",
    Icon: FaSlack,
  },
  {
    title: "Discord",
    description: "Notify a Discord channel via webhooks.",
    href: "/integrations/discord-webhooks",
    Icon: FaDiscord,
  },
  {
    title: "Microsoft Teams",
    description: "Notify a Teams channel via Incoming Webhooks.",
    href: "/integrations/microsoft-teams",
    Icon: TbBrandTeams,
  },
  {
    title: "SOAR",
    description: "Send a JSON payload to a generic SOAR webhook (Tines / XSOAR / custom).",
    href: "/integrations/soar-webhooks",
    Icon: Workflow,
  },
  {
    title: "Email digest",
    description: "Preview a daily/weekly digest of findings (email delivery comes next).",
    href: "/integrations/email-digest",
    Icon: Mail,
  },
  {
    title: "Splunk",
    description: "Push SPL detections into Splunk as saved searches.",
    href: "/integrations/splunk",
    Icon: SiSplunk,
  },
  {
    title: "Vulnerability Scanners",
    description: "Sync Tenable / Qualys / Rapid7 exposure and correlate affected host counts to CVEs. (OpenVAS coming soon.)",
    href: "/integrations/vuln-scanners",
    Icon: ShieldAlert,
  },
  {
    title: "TheHive",
    description: "Sync cases for MTTD/MTTR/containment and playbook ROI.",
    href: "/integrations/thehive",
    Icon: FileSearch,
  },
] as const;

export default function ConnectionsPage() {
  return (
      <div className="mx-auto max-w-[1600px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Connections</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Manage integrations (webhooks + digests) that receive findings or incident context.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {CONNECTIONS.map(({ title, description, href, Icon }) => (
          <Card key={href} className="hover:shadow-2xl transition-shadow">
            <CardHeader
              title={
                <div className="flex items-center gap-2">
                  <Icon size={18} aria-hidden="true" />
                  <span>{title}</span>
                </div>
              }
              description={description}
            />
            <CardContent>
              <Link
                href={href}
                className="inline-flex rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
              >
                Manage
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
