export type SystemAgentKey =
  | "vuln"
  | "exploit"
  | "attack"
  | "ttp"
  | "malware"
  | "actor-profile"
  | "navigator"
  | "merge"
  | "custom-runner";

export type SystemAgentMeta = {
  key: SystemAgentKey;
  title: string;
  short: string;
  produces?: string;
};

export const SYSTEM_AGENTS: SystemAgentMeta[] = [
  { key: "vuln", title: "CVE agent", short: "Fetches CVEs + KEV, summarizes, writes findings.", produces: "findings (agent=vuln)" },
  { key: "exploit", title: "Exploit agent", short: "Tracks PoCs and time-to-exploit signals.", produces: "findings (agent=exploit)" },
  { key: "attack", title: "Threat feed agent", short: "Ingests threat intel RSS + advisories.", produces: "documents + findings (agent=attack)" },
  { key: "ttp", title: "TTP agent", short: "Syncs MITRE ATT&CK techniques, actors, relations.", produces: "knowledge graph (kg_entities/kg_relations)" },
  { key: "malware", title: "Malware agent", short: "Pulls new malware samples and metadata.", produces: "findings (agent=malware)" },
  { key: "actor-profile", title: "Actor profile agent", short: "Builds actor profiles + neighbors (offline).", produces: "actor_profiles + actor_neighbors" },
  { key: "navigator", title: "Navigator agent", short: "Recomputes Navigator scenarios for Pro users.", produces: "navigator_scenarios" },
  { key: "merge", title: "Merge agent", short: "Applies accepted entity merges (manual trigger).", produces: "knowledge graph merges" },
  { key: "custom-runner", title: "Custom agent runner", short: "Executes user-created agents on a schedule.", produces: "agent_outputs" },
];

