export type PlaybookStatus = "draft" | "approved" | "archived";

export type PlaybookSourceKind = "manual" | "navigator_scenario" | "finding";

export type PlaybookContentFormat = "json" | "yaml";

export type PlaybookIncidentType =
  | "vulnerability_exploitation"
  | "credential_compromise"
  | "ransomware"
  | "supply_chain"
  | "lateral_movement"
  | "data_exfiltration";

export type NistPhaseId =
  | "preparation"
  | "detection_analysis"
  | "containment"
  | "eradication"
  | "recovery"
  | "post_incident";

export type PlaybookToolId = "splunk" | "jira" | "slack" | "discord" | "soar" | "manual";

export type ToolActionKind = "note" | "query" | "http" | "ui";

export type PlaybookToolAction = {
  tool: PlaybookToolId;
  kind: ToolActionKind;
  label: string;
  content: string;
  href?: string;
};

export type PlaybookStep = {
  id: string;
  title: string;
  description: string;
  ownerRole: string;
  estimatedMinutes?: number;
  toolActions?: PlaybookToolAction[];
};

export type PlaybookPhase = {
  id: NistPhaseId;
  title: string;
  description: string;
  estimatedMinutes?: number;
  steps: PlaybookStep[];
};

export type PlaybookContentV1 = {
  version: 1;
  title: string;
  incidentType: PlaybookIncidentType;
  executiveSummary: string;
  phases: PlaybookPhase[];
};
