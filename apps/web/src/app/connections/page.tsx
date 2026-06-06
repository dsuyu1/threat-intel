export const runtime = "edge";

import Link from "next/link";
import { Webhook, Workflow } from "lucide-react";
import { FaDiscord, FaSlack } from "react-icons/fa";
import { SiSplunk } from "react-icons/si";
import { Card, CardContent, CardHeader } from "../../components/ui/Card";

const CONNECTIONS = [
  {
    title: "Jira Automation",
    description: "Create/update issues via Jira Automation incoming webhooks.",
    href: "/integrations/jira-automation",
    Icon: Webhook,
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
    title: "SOAR",
    description: "Send a JSON payload to a generic SOAR webhook (Tines / XSOAR / custom).",
    href: "/integrations/soar-webhooks",
    Icon: Workflow,
  },
  {
    title: "Splunk",
    description: "Push SPL detections into Splunk as saved searches.",
    href: "/integrations/splunk",
    Icon: SiSplunk,
  },
] as const;

export default function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Connections</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Manage outbound integrations (webhooks) that receive findings.
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
