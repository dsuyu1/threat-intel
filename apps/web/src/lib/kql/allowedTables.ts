const PRO_TABLES = [
  "Actors",
  "ActorProfiles",
  "Findings",
  "Documents",
  "Sources",
  "KgEntities",
  "KgRelations",
  "KgEvidence",
  "Iocs",
  "Playbooks",
  "NavigatorScenarios",
  "NavigatorDetections",
  "RiskEntries",
] as const;
const FREE_TABLES = ["Findings", "Documents", "Sources"] as const;

export type KqlAllowedTable = (typeof PRO_TABLES)[number];

export function allowedTablesForTier(tier: string) {
  return String(tier ?? "").toLowerCase() === "pro" ? [...PRO_TABLES] : [...FREE_TABLES];
}
