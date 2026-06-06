export type NavigatorRiskAppetite = "conservative" | "balanced" | "aggressive";

export type CrownJewelId =
  | "customer_data"
  | "identity"
  | "payments"
  | "prod_apps"
  | "source_code"
  | "ot_it"
  | "email"
  | "endpoints";

export type CrownJewel = { id: CrownJewelId; weight: number };

export const CROWN_JEWELS: Array<{
  id: CrownJewelId;
  label: string;
  description: string;
}> = [
  { id: "customer_data", label: "Customer Data", description: "PII, PHI, account records, and sensitive customer datasets." },
  { id: "identity", label: "Identity", description: "IdP, SSO, privileged accounts, and directory services." },
  { id: "payments", label: "Payments", description: "Payment flows, PCI systems, billing platforms." },
  { id: "prod_apps", label: "Production Apps", description: "Revenue and mission-critical production applications." },
  { id: "source_code", label: "Source Code", description: "Repos, CI/CD, build systems, signing keys." },
  { id: "ot_it", label: "OT/IT", description: "OT environments or critical industrial/operations networks." },
  { id: "email", label: "Email", description: "Mailboxes, transport rules, executive comms." },
  { id: "endpoints", label: "Endpoints", description: "Workstations and servers (EDR coverage, local admin, patching)." },
];

export const RISK_APPETITES: Array<{ id: NavigatorRiskAppetite; label: string; help: string }> = [
  { id: "conservative", label: "Conservative", help: "Show fewer items as High; focus only on top-ranked scenarios." },
  { id: "balanced", label: "Balanced", help: "Default thresholds for High/Medium/Low bands." },
  { id: "aggressive", label: "Aggressive", help: "Surface more items as High to drive broader validation work." },
];

export function scoreBand(score: number, appetite: NavigatorRiskAppetite) {
  const s = Number(score ?? 0);
  const high = appetite === "conservative" ? 85 : appetite === "aggressive" ? 65 : 75;
  const med = appetite === "conservative" ? 60 : appetite === "aggressive" ? 40 : 50;
  if (s >= high) return "high";
  if (s >= med) return "medium";
  return "low";
}

export function parseStackText(input: string) {
  const lines = String(input ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: Array<{ technology: string; versionRange?: string | null }> = [];
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
    const technology = parts[0] ?? "";
    if (!technology) continue;
    const versionRange = parts[1] ?? null;
    out.push({ technology, versionRange });
  }

  // Deduplicate by technology (case-insensitive).
  const deduped: typeof out = [];
  const seen = new Set<string>();
  for (const it of out) {
    const key = it.technology.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  return deduped;
}

