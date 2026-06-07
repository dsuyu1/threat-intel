import "server-only";

import { discordWebhookConnections, findings, getDb, jiraAutomationConnections, navigatorScenarios, slackWebhookConnections, soarWebhookConnections, splunkConnections } from "@ti/db";
import { and, desc, eq } from "drizzle-orm";
import type { PlaybookContentV1, PlaybookIncidentType, PlaybookSourceKind } from "./types";

type ToolAvailability = {
  jira: { count: number; names: string[] } | null;
  slack: { count: number; names: string[] } | null;
  discord: { count: number; names: string[] } | null;
  soar: { count: number; names: string[] } | null;
  splunk: { count: number; names: string[] } | null;
};

type FindingContext = {
  id: string;
  title: string;
  summary: string | null;
  severity: string | null;
  cveId: string | null;
  cvssScore: string | null;
  cvssVector: string | null;
  pocUrl: string | null;
  publishedAtIso: string | null;
  sourceUrl: string | null;
};

type ScenarioContext = {
  id: string;
  title: string;
  summary: string | null;
  scenarioType: string;
  actorId: string;
  actorName: string | null;
  primaryTactic: string | null;
  tactics: string[] | null;
  targetKind: string;
  targetId: string;
  targetName: string | null;
  evidenceUrls: string[];
  computedAtIso: string | null;
};

function safeIso(d: Date | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

function pickIncidentTypeFromTactic(tactic: string | null): PlaybookIncidentType {
  const t = String(tactic ?? "").trim().toLowerCase();
  if (t === "credential-access") return "credential_compromise";
  if (t === "lateral-movement") return "lateral_movement";
  if (t === "exfiltration") return "data_exfiltration";
  if (t === "impact") return "ransomware";
  return "lateral_movement";
}

export function friendlyIncidentType(t: PlaybookIncidentType) {
  if (t === "vulnerability_exploitation") return "Vulnerability exploitation";
  if (t === "credential_compromise") return "Credential compromise";
  if (t === "ransomware") return "Ransomware";
  if (t === "supply_chain") return "Supply chain";
  if (t === "lateral_movement") return "Lateral movement";
  return "Data exfiltration";
}

function phase(id: PlaybookContentV1["phases"][number]["id"]) {
  if (id === "preparation") return { title: "Preparation", description: "Get ready to respond quickly and safely." };
  if (id === "detection_analysis")
    return { title: "Detection & Analysis", description: "Confirm the incident, scope impact, and collect evidence." };
  if (id === "containment") return { title: "Containment", description: "Stop spread and reduce attacker access." };
  if (id === "eradication") return { title: "Eradication", description: "Remove persistence and fix root cause." };
  if (id === "recovery") return { title: "Recovery", description: "Restore services and monitor for recurrence." };
  return { title: "Post-Incident", description: "Learn, harden, and update detections/runbooks." };
}

type TemplateStep = {
  id: string;
  title: string;
  description: string;
  ownerRole: string;
  estimatedMinutes?: number;
  actionKind:
    | "create_ticket"
    | "notify_chatops"
    | "soar_trigger"
    | "siem_hunt"
    | "collect_evidence"
    | "contain_hosts"
    | "patch_or_eradicate"
    | "recovery_monitor"
    | "post_incident_review";
};

type TemplatePhase = {
  id: PlaybookContentV1["phases"][number]["id"];
  steps: TemplateStep[];
};

function templateForIncidentType(t: PlaybookIncidentType): TemplatePhase[] {
  const base: TemplatePhase[] = [
    {
      id: "preparation",
      steps: [
        {
          id: "prep.ticket",
          title: "Open incident ticket",
          description: "Create a case to track timeline, decisions, and artifacts from the start.",
          ownerRole: "Incident Commander",
          actionKind: "create_ticket",
          estimatedMinutes: 5,
        },
        {
          id: "prep.notify",
          title: "Notify responders",
          description: "Start an incident channel and notify on-call responders.",
          ownerRole: "Incident Commander",
          actionKind: "notify_chatops",
          estimatedMinutes: 5,
        },
      ],
    },
    {
      id: "detection_analysis",
      steps: [
        {
          id: "detect.scope",
          title: "Confirm and scope",
          description:
            "Validate the alert/hypothesis, determine what is affected, and establish the initial timeline.",
          ownerRole: "SOC Analyst",
          actionKind: "siem_hunt",
          estimatedMinutes: 30,
        },
        {
          id: "detect.evidence",
          title: "Preserve evidence",
          description: "Capture logs and volatile artifacts needed for later analysis and reporting.",
          ownerRole: "SOC Analyst",
          actionKind: "collect_evidence",
          estimatedMinutes: 20,
        },
      ],
    },
    {
      id: "containment",
      steps: [
        {
          id: "contain.stop",
          title: "Contain affected systems",
          description: "Reduce attacker access and stop spread while preserving evidence.",
          ownerRole: "IT Ops",
          actionKind: "contain_hosts",
          estimatedMinutes: 60,
        },
      ],
    },
    {
      id: "eradication",
      steps: [
        {
          id: "eradicate.fix",
          title: "Remove root cause",
          description: "Apply fixes and remove persistence; verify the attacker path is closed.",
          ownerRole: "IT Ops",
          actionKind: "patch_or_eradicate",
          estimatedMinutes: 120,
        },
      ],
    },
    {
      id: "recovery",
      steps: [
        {
          id: "recover.restore",
          title: "Restore and monitor",
          description: "Bring systems back safely and monitor for recurrence.",
          ownerRole: "IT Ops",
          actionKind: "recovery_monitor",
          estimatedMinutes: 120,
        },
      ],
    },
    {
      id: "post_incident",
      steps: [
        {
          id: "post.review",
          title: "Post-incident review",
          description: "Document what happened, what worked, and what to change.",
          ownerRole: "Incident Commander",
          actionKind: "post_incident_review",
          estimatedMinutes: 60,
        },
      ],
    },
  ];

  if (t === "vulnerability_exploitation") {
    base[1]!.steps.unshift({
      id: "detect.vuln",
      title: "Validate vulnerable surface",
      description:
        "Confirm the affected product/version exists in your environment and whether it is externally reachable.",
      ownerRole: "SOC Analyst",
      actionKind: "siem_hunt",
      estimatedMinutes: 30,
    });
  }

  if (t === "credential_compromise") {
    base[2]!.steps.unshift({
      id: "contain.identity",
      title: "Contain identity access",
      description: "Reset credentials/tokens, enforce MFA, and restrict affected accounts.",
      ownerRole: "IT Ops",
      actionKind: "contain_hosts",
      estimatedMinutes: 60,
    });
  }

  if (t === "ransomware") {
    base[2]!.steps.unshift({
      id: "contain.network",
      title: "Stop spread",
      description: "Isolate impacted segments/hosts quickly and disable lateral movement paths.",
      ownerRole: "IT Ops",
      actionKind: "contain_hosts",
      estimatedMinutes: 60,
    });
  }

  return base;
}

function buildExecutiveSummary(params: {
  title: string;
  incidentType: PlaybookIncidentType;
  source: { kind: PlaybookSourceKind; id?: string } | null;
  scenario: ScenarioContext | null;
  finding: FindingContext | null;
  tools: ToolAvailability;
}) {
  const lines: string[] = [];
  lines.push(`${params.title}`);
  lines.push("");
  lines.push(`Type: ${friendlyIncidentType(params.incidentType)}`);
  if (params.scenario) {
    const actorLabel = params.scenario.actorName ? `${params.scenario.actorName} (${params.scenario.actorId})` : params.scenario.actorId;
    lines.push(`Threat: ${actorLabel}`);
    lines.push(`Attack path: ${params.scenario.title}`);
  }
  if (params.finding?.cveId) {
    lines.push(`CVE: ${params.finding.cveId}`);
    if (params.finding.cvssVector) lines.push(`CVSS: ${params.finding.cvssVector}`);
  }

  const enabledTools = [
    params.tools.jira?.count ? `Jira (${params.tools.jira.count})` : null,
    params.tools.slack?.count ? `Slack (${params.tools.slack.count})` : null,
    params.tools.discord?.count ? `Discord (${params.tools.discord.count})` : null,
    params.tools.soar?.count ? `SOAR (${params.tools.soar.count})` : null,
    params.tools.splunk?.count ? `Splunk (${params.tools.splunk.count})` : null,
  ].filter(Boolean);
  lines.push("");
  lines.push(`Available tooling: ${enabledTools.length ? enabledTools.join(", ") : "Not configured yet"}`);
  lines.push("Status: Draft (requires review/approval).");
  return lines.join("\n");
}

function injectToolsIntoSteps(params: {
  steps: TemplateStep[];
  tools: ToolAvailability;
  scenario: ScenarioContext | null;
  finding: FindingContext | null;
}) {
  const { tools } = params;
  const urls: string[] = [];
  if (params.scenario?.evidenceUrls?.length) urls.push(...params.scenario.evidenceUrls);
  if (params.finding?.sourceUrl) urls.push(params.finding.sourceUrl);
  if (params.finding?.pocUrl) urls.push(params.finding.pocUrl);
  const uniqUrls = Array.from(new Set(urls.filter(Boolean)));

  return params.steps.map((s) => {
    const toolActions: NonNullable<PlaybookContentV1["phases"][number]["steps"][number]["toolActions"]> = [];

    if (s.actionKind === "create_ticket") {
      if (tools.jira?.count) {
        toolActions.push({
          tool: "jira",
          kind: "note",
          label: `Create ticket (Jira Automation: ${tools.jira.names[0] ?? "connection"})`,
          content:
            "Use your Jira Automation incoming webhook to create an Incident issue.\n\nRecommended fields:\n- Summary: <INCIDENT_TITLE>\n- Severity: <SEV>\n- Source: Threat Intel Platform\n- Links: include the relevant Finding/Navigator URL\n- Labels: incident, threat-intel, playbook\n",
          href: "/integrations/jira-automation",
        });
      } else {
        toolActions.push({
          tool: "manual",
          kind: "note",
          label: "Create ticket",
          content: "Create an incident ticket in your case management system (recommended: Jira Automation connection).",
          href: "/connections",
        });
      }
    }

    if (s.actionKind === "notify_chatops") {
      if (tools.slack?.count) {
        toolActions.push({
          tool: "slack",
          kind: "note",
          label: `Notify Slack (${tools.slack.names[0] ?? "connection"})`,
          content:
            "Send a message to your incident channel.\n\nSuggested message:\n- Incident opened: <TITLE>\n- Link: <PLAYBOOK_URL>\n- Next step: confirm scope and evidence\n",
          href: "/integrations/slack-webhooks",
        });
      }
      if (tools.discord?.count) {
        toolActions.push({
          tool: "discord",
          kind: "note",
          label: `Notify Discord (${tools.discord.names[0] ?? "connection"})`,
          content:
            "Send a message to your incident channel.\n\nSuggested message:\n- Incident opened: <TITLE>\n- Link: <PLAYBOOK_URL>\n",
          href: "/integrations/discord-webhooks",
        });
      }

      if (!tools.slack?.count && !tools.discord?.count) {
        toolActions.push({
          tool: "manual",
          kind: "note",
          label: "Notify responders",
          content: "Notify responders via your incident comms channel (Slack/Discord recommended).",
          href: "/connections",
        });
      }
    }

    if (s.actionKind === "soar_trigger") {
      if (tools.soar?.count) {
        toolActions.push({
          tool: "soar",
          kind: "http",
          label: `Trigger SOAR workflow (${tools.soar.names[0] ?? "connection"})`,
          content:
            "Trigger your SOAR webhook with a structured incident payload.\n\nSuggested payload keys:\n- incident.title\n- incident.type\n- entities.hosts\n- entities.users\n- iocs\n- links\n",
          href: "/integrations/soar-webhooks",
        });
      }
    }

    if (s.actionKind === "siem_hunt") {
      if (tools.splunk?.count) {
        const cve = params.finding?.cveId ?? (params.scenario?.targetKind === "cve" ? params.scenario.targetId : null);
        const actor = params.scenario?.actorName ?? params.scenario?.actorId ?? null;
        const iocs = uniqUrls.slice(0, 4);
        const terms = [
          cve ? `"${cve}"` : null,
          actor ? `"${actor}"` : null,
          ...iocs.map((u) => `"${u}"`),
        ].filter(Boolean);
        const termBlock = terms.length ? terms.join(" OR ") : "<IOC_OR_CVE_OR_ACTOR>";

        toolActions.push({
          tool: "splunk",
          kind: "query",
          label: `Hunt in Splunk (${tools.splunk.names[0] ?? "connection"})`,
          content:
            `index=<INDEX> ${termBlock}\n| stats count min(_time) as firstSeen max(_time) as lastSeen by host, sourcetype, source\n| sort -count\n`,
          href: "/integrations/splunk",
        });
      } else {
        toolActions.push({
          tool: "manual",
          kind: "note",
          label: "SIEM hunt",
          content: "Run a hunt in your SIEM for relevant IOCs, CVEs, and actor/TTP indicators (Splunk recommended).",
          href: "/connections",
        });
      }
    }

    if (s.actionKind === "collect_evidence") {
      const evidence = uniqUrls.length
        ? `Relevant links:\n${uniqUrls.slice(0, 8).map((u) => `- ${u}`).join("\n")}\n`
        : "Capture evidence links, logs, and screenshots in the incident ticket.\n";
      toolActions.push({
        tool: "manual",
        kind: "note",
        label: "Evidence checklist",
        content:
          `Preserve:\n- SIEM/EDR logs (export)\n- Authentication logs\n- Network telemetry\n- System timestamps\n\n${evidence}`,
      });
    }

    if (s.actionKind === "contain_hosts") {
      toolActions.push({
        tool: "manual",
        kind: "note",
        label: "Containment actions",
        content:
          "Containment options (choose the least disruptive that stops spread):\n- Isolate affected hosts\n- Block IOCs at perimeter\n- Disable compromised accounts\n- Disable exposed services\n",
      });
    }

    if (s.actionKind === "patch_or_eradicate") {
      const cve = params.finding?.cveId ?? (params.scenario?.targetKind === "cve" ? params.scenario.targetId : null);
      toolActions.push({
        tool: "manual",
        kind: "note",
        label: "Eradication checklist",
        content:
          `Eradication:\n- Patch/mitigate${cve ? ` (${cve})` : ""}\n- Remove persistence\n- Reset credentials/tokens where needed\n- Validate with re-hunt + verification\n`,
      });
    }

    if (s.actionKind === "recovery_monitor") {
      toolActions.push({
        tool: "manual",
        kind: "note",
        label: "Recovery checklist",
        content:
          "Recovery:\n- Restore services from known-good state\n- Monitor for recurrence (24–72h)\n- Add short-term alerting/thresholds\n",
      });
    }

    if (s.actionKind === "post_incident_review") {
      toolActions.push({
        tool: "manual",
        kind: "note",
        label: "Lessons learned",
        content:
          "Capture:\n- Root cause\n- Time to detect/contain/recover\n- Gaps in logging/detection\n- Hardening items + owners\n- Updates needed to Navigator/Risk\n",
      });
    }

    return {
      id: s.id,
      title: s.title,
      description: s.description,
      ownerRole: s.ownerRole,
      estimatedMinutes: s.estimatedMinutes,
      toolActions: toolActions.length ? toolActions : undefined,
    };
  });
}

export async function getToolAvailability(params: { projectId: string }) {
  const db = getDb();

  const [jira, slack, discord, soar, splunk] = await Promise.all([
    db
      .select({ name: jiraAutomationConnections.name })
      .from(jiraAutomationConnections)
      .where(and(eq(jiraAutomationConnections.projectId, params.projectId), eq(jiraAutomationConnections.enabled, true)))
      .orderBy(desc(jiraAutomationConnections.updatedAt))
      .limit(20)
      .catch(() => [] as Array<{ name: string }>),
    db
      .select({ name: slackWebhookConnections.name })
      .from(slackWebhookConnections)
      .where(and(eq(slackWebhookConnections.projectId, params.projectId), eq(slackWebhookConnections.enabled, true)))
      .orderBy(desc(slackWebhookConnections.updatedAt))
      .limit(20)
      .catch(() => [] as Array<{ name: string }>),
    db
      .select({ name: discordWebhookConnections.name })
      .from(discordWebhookConnections)
      .where(and(eq(discordWebhookConnections.projectId, params.projectId), eq(discordWebhookConnections.enabled, true)))
      .orderBy(desc(discordWebhookConnections.updatedAt))
      .limit(20)
      .catch(() => [] as Array<{ name: string }>),
    db
      .select({ name: soarWebhookConnections.name })
      .from(soarWebhookConnections)
      .where(and(eq(soarWebhookConnections.projectId, params.projectId), eq(soarWebhookConnections.enabled, true)))
      .orderBy(desc(soarWebhookConnections.updatedAt))
      .limit(20)
      .catch(() => [] as Array<{ name: string }>),
    db
      .select({ name: splunkConnections.name })
      .from(splunkConnections)
      .where(and(eq(splunkConnections.projectId, params.projectId), eq(splunkConnections.enabled, true)))
      .orderBy(desc(splunkConnections.updatedAt))
      .limit(20)
      .catch(() => [] as Array<{ name: string }>),
  ]);

  const to = (rows: Array<{ name: string }>) => {
    const names = rows.map((r) => r.name).filter(Boolean);
    return names.length ? { count: names.length, names } : null;
  };

  return {
    jira: to(jira),
    slack: to(slack),
    discord: to(discord),
    soar: to(soar),
    splunk: to(splunk),
  } satisfies ToolAvailability;
}

export async function getScenarioContext(params: { scenarioId: string; projectId: string }) {
  const db = getDb();
  const [row] = await db
    .select({
      id: navigatorScenarios.id,
      title: navigatorScenarios.title,
      summary: navigatorScenarios.summary,
      scenarioType: navigatorScenarios.scenarioType,
      actorId: navigatorScenarios.actorId,
      actorName: navigatorScenarios.actorName,
      primaryTactic: navigatorScenarios.primaryTactic,
      tactics: navigatorScenarios.tactics,
      targetKind: navigatorScenarios.targetKind,
      targetId: navigatorScenarios.targetId,
      targetName: navigatorScenarios.targetName,
      evidenceJson: navigatorScenarios.evidenceJson,
      computedAt: navigatorScenarios.computedAt,
    })
    .from(navigatorScenarios)
    .where(and(eq(navigatorScenarios.id, params.scenarioId), eq(navigatorScenarios.projectId, params.projectId)))
    .limit(1);

  if (!row) return null;
  const evidenceItems = ((row.evidenceJson as any)?.items ?? []) as Array<{ url?: string }>;
  const evidenceUrls = evidenceItems.map((x) => String(x?.url ?? "").trim()).filter(Boolean);

  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    scenarioType: String(row.scenarioType),
    actorId: row.actorId,
    actorName: row.actorName ?? null,
    primaryTactic: row.primaryTactic ?? null,
    tactics: (row.tactics as any) ? (row.tactics as any as string[]) : null,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetName: row.targetName ?? null,
    evidenceUrls,
    computedAtIso: safeIso(row.computedAt),
  } satisfies ScenarioContext;
}

export async function getFindingContext(params: { findingId: string }) {
  const db = getDb();
  const [row] = await db
    .select({
      id: findings.id,
      title: findings.title,
      summary: findings.summary,
      severity: findings.severity,
      cveId: findings.cveId,
      cvssScore: findings.cvssScore,
      cvssVector: findings.cvssVector,
      pocUrl: findings.pocUrl,
      publishedAt: findings.publishedAt,
      sourceUrl: findings.sourceUrl,
    })
    .from(findings)
    .where(eq(findings.id, params.findingId))
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    severity: row.severity ? String(row.severity) : null,
    cveId: row.cveId ?? null,
    cvssScore: row.cvssScore ? String(row.cvssScore) : null,
    cvssVector: row.cvssVector ?? null,
    pocUrl: row.pocUrl ?? null,
    publishedAtIso: safeIso(row.publishedAt),
    sourceUrl: row.sourceUrl ?? null,
  } satisfies FindingContext;
}

export function inferIncidentType(params: {
  requested: PlaybookIncidentType | null;
  sourceKind: PlaybookSourceKind;
  scenario: ScenarioContext | null;
  finding: FindingContext | null;
}): PlaybookIncidentType {
  if (params.requested) return params.requested;

  if (params.sourceKind === "navigator_scenario" && params.scenario) {
    if (params.scenario.scenarioType === "cve") return "vulnerability_exploitation";
    return pickIncidentTypeFromTactic(params.scenario.primaryTactic);
  }

  if (params.sourceKind === "finding" && params.finding) {
    if (params.finding.cveId) return "vulnerability_exploitation";
  }

  return "vulnerability_exploitation";
}

export function defaultPlaybookTitle(params: {
  incidentType: PlaybookIncidentType;
  sourceKind: PlaybookSourceKind;
  scenario: ScenarioContext | null;
  finding: FindingContext | null;
}) {
  if (params.scenario) {
    const actor = params.scenario.actorName ?? params.scenario.actorId;
    return `IR Playbook: ${actor} — ${params.scenario.title}`;
  }
  if (params.finding) {
    const cve = params.finding.cveId ? ` ${params.finding.cveId}` : "";
    return `IR Playbook:${cve} ${params.finding.title}`.trim();
  }
  return `IR Playbook: ${friendlyIncidentType(params.incidentType)}`;
}

export function generatePlaybookContent(params: {
  title: string;
  incidentType: PlaybookIncidentType;
  source: { kind: PlaybookSourceKind; id?: string } | null;
  tools: ToolAvailability;
  scenario: ScenarioContext | null;
  finding: FindingContext | null;
}): { content: PlaybookContentV1; context: Record<string, any> } {
  const template = templateForIncidentType(params.incidentType);

  const phases = template.map((p) => {
    const meta = phase(p.id);
    return {
      id: p.id,
      title: meta.title,
      description: meta.description,
      steps: injectToolsIntoSteps({ steps: p.steps, tools: params.tools, scenario: params.scenario, finding: params.finding }),
    };
  });

  const executiveSummary = buildExecutiveSummary({
    title: params.title,
    incidentType: params.incidentType,
    source: params.source,
    scenario: params.scenario,
    finding: params.finding,
    tools: params.tools,
  });

  const context: Record<string, any> = {
    source: params.source,
    incidentType: params.incidentType,
    scenario: params.scenario,
    finding: params.finding,
    tools: params.tools,
  };

  return {
    content: {
      version: 1,
      title: params.title,
      incidentType: params.incidentType,
      executiveSummary,
      phases,
    },
    context,
  };
}

