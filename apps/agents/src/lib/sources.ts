import { getDb, sources } from "@ti/db";
import { eq, and, sql } from "drizzle-orm";

export const DEFAULT_STIX_SOURCE = {
  name: "MITRE ATT&CK Enterprise STIX",
  type: "stix" as const,
  url: "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json",
  reliability: 1,
};

export const DEFAULT_RSS_SOURCES = [
  {
    name: "CISA Alerts",
    type: "rss" as const,
    url: "https://www.cisa.gov/cybersecurity-advisories/alerts.xml",
    reliability: 1,
  },
  {
    name: "CISA Cybersecurity Advisories",
    type: "rss" as const,
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    reliability: 1,
  },
  {
    name: "Microsoft Security Blog",
    type: "rss" as const,
    url: "https://www.microsoft.com/en-us/security/blog/feed/",
    reliability: 0.95,
  },
  {
    name: "Google Security Blog",
    type: "rss" as const,
    url: "https://blog.google/security/rss/",
    reliability: 0.95,
  },
  {
    name: "Palo Alto Unit 42",
    type: "rss" as const,
    url: "https://unit42.paloaltonetworks.com/feed/",
    reliability: 0.95,
  },
  {
    name: "CrowdStrike Blog",
    type: "rss" as const,
    url: "https://www.crowdstrike.com/en-us/blog/feed/",
    reliability: 0.95,
  },
  {
    name: "Cisco Talos",
    type: "rss" as const,
    url: "https://blog.talosintelligence.com/rss/",
    reliability: 0.9,
  },
  {
    name: "SentinelLabs",
    type: "rss" as const,
    url: "https://www.sentinelone.com/labs/feed/",
    reliability: 0.9,
  },
  {
    name: "Rapid7 Threat Intel",
    type: "rss" as const,
    url: "https://blog.rapid7.com/tag/threat-intel/rss/",
    reliability: 0.9,
  },
  {
    name: "ESET WeLiveSecurity",
    type: "rss" as const,
    url: "https://www.welivesecurity.com/en/rss/feed/",
    reliability: 0.85,
  },
];

export async function ensureDefaultSources(): Promise<void> {
  const db = getDb();

  const existing = await db.select().from(sources);

  // Migrate known old CISA RSS URLs (CISA has moved these a few times)
  if (existing.length > 0) {
    const migrations = [
      {
        from: "https://www.cisa.gov/about/contact-us/subscribe-updates-cisa/rss-feeds/cisa-alerts.xml",
        to: "https://www.cisa.gov/cybersecurity-advisories/alerts.xml",
        name: "CISA Alerts",
        reliability: 1,
      },
      {
        from: "https://www.cisa.gov/about/contact-us/subscribe-updates-cisa/rss-feeds/cisa-advisories.xml",
        to: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
        name: "CISA Cybersecurity Advisories",
        reliability: 1,
      },
      {
        from: "https://blog.google/threat-analysis-group/rss/",
        to: "https://blog.google/security/rss/",
        name: "Google Security Blog",
        reliability: 0.95,
      },
    ] as const;

    for (const m of migrations) {
      const hasTo = existing.some((s) => s.url === m.to);
      if (hasTo) {
        await db
          .update(sources)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(sources.url, m.from));
      } else {
        await db
          .update(sources)
          .set({ url: m.to, name: m.name, reliability: m.reliability, updatedAt: new Date() })
          .where(eq(sources.url, m.from));
      }
    }
  }

  const defaults = [DEFAULT_STIX_SOURCE, ...DEFAULT_RSS_SOURCES];
  const now = new Date();

  // DB-managed sources: upsert defaults so new installs get sane coverage,
  // but allow turning sources on/off via DB without code changes.
  await db
    .insert(sources)
    .values(
      defaults.map((s) => ({
        ...s,
        enabled: true,
        lastFetchedAt: null,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [sources.url],
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        reliability: sql`excluded.reliability`,
        updatedAt: now,
      },
    });
}

export async function getEnabledSources(type: "rss" | "stix") {
  const db = getDb();
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.type, type), eq(sources.enabled, true)));
}
