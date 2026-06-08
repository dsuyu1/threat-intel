export type SystemAgentKey =
  | "vuln"
  | "vuln-scanners"
  | "exploit"
  | "attack"
  | "ttp"
  | "malware"
  | "thehive"
  | "actor-profile"
  | "navigator"
  | "detections"
  | "merge"
  | "ioc-taxii"
  | "ioc-enrich"
  | "custom-runner";

export type SystemAgentMeta = {
  key: SystemAgentKey;
  title: string;
  short: string;
  produces?: string;
};

export const SYSTEM_AGENTS: SystemAgentMeta[] = [
  { key: "vuln", title: "CVE agent", short: "Fetches CVEs + KEV, summarizes, writes findings.", produces: "findings (agent=vuln)" },
  { key: "vuln-scanners", title: "Vulnerability scanner sync", short: "Pulls Tenable/Qualys/Rapid7 exposure and correlates host counts to CVEs.", produces: "vuln_scanner_* tables + CVE exposure" },
  { key: "exploit", title: "Exploit agent", short: "Tracks PoCs and time-to-exploit signals.", produces: "findings (agent=exploit)" },
  { key: "attack", title: "Threat feed agent", short: "Ingests RSS + runs AI extraction (actors, sectors, CVEs). Backfills ~30 days on first run.", produces: "documents + findings (agent=attack) + KG relations" },
  { key: "ttp", title: "TTP agent", short: "Syncs MITRE ATT&CK STIX (no AI): actors, techniques, mitigations, CVE refs.", produces: "knowledge graph (kg_entities/kg_relations)" },
  { key: "malware", title: "Malware agent", short: "Pulls new malware samples and metadata.", produces: "findings (agent=malware)" },
  { key: "thehive", title: "TheHive sync agent", short: "Syncs incident cases for MTTD/MTTR/containment metrics.", produces: "incidents" },
  { key: "actor-profile", title: "Actor profile agent", short: "Builds actor profiles + neighbors (offline).", produces: "actor_profiles + actor_neighbors" },
  { key: "navigator", title: "Navigator agent", short: "Recomputes Navigator scenarios for Pro users.", produces: "navigator_scenarios" },
  { key: "detections", title: "Detections agent", short: "Generates Sigma/KQL/SPL detections for validated technique scenarios.", produces: "navigator_detections" },
  { key: "merge", title: "Merge agent", short: "Applies accepted entity merges (manual trigger).", produces: "knowledge graph merges" },
  { key: "ioc-taxii", title: "IOC TAXII import agent", short: "Imports indicators from TAXII 2.1 feeds (OpenCTI-compatible).", produces: "iocs + ioc_sources" },
  { key: "ioc-enrich", title: "IOC enrichment agent", short: "Drains IOC enrichment jobs (VirusTotal/Shodan).", produces: "ioc_enrichments" },
  { key: "custom-runner", title: "Custom agent runner", short: "Executes user-created agents on a schedule.", produces: "agent_outputs" },
];
