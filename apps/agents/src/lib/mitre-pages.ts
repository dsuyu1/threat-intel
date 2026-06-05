function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function parseMitreCampaignIndex(html: string): Array<{ id: string; name: string; url: string }> {
  // Supports either relative links:
  //   <a href="/campaigns/C0028">...</a>
  // or absolute links:
  //   <a href="https://attack.mitre.org/campaigns/C0028/">...</a>
  const byId = new Map<string, { id: string; name: string; url: string; candidates: string[] }>();

  const re =
    /href=["'](?:https?:\/\/attack\.mitre\.org)?\/campaigns\/(C\d{4})\/?["'][^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1];
    const text = String(m[2] ?? "").trim().replace(/\s+/g, " ");
    if (!id || !text) continue;

    let cur = byId.get(id);
    if (!cur) {
      cur = {
        id,
        name: id,
        url: `https://attack.mitre.org/campaigns/${id}/`,
        candidates: [],
      };
      byId.set(id, cur);
    }
    cur.candidates.push(text);
  }

  const out: Array<{ id: string; name: string; url: string }> = [];
  for (const c of byId.values()) {
    const best = c.candidates.find((t) => t !== c.id) ?? c.id;
    out.push({ id: c.id, name: best, url: c.url });
  }

  return out;
}

export function parseGroupsFromCampaignPage(html: string): string[] {
  // Supports either relative links:
  //   <a href="/groups/G0034">...</a>
  // or absolute links:
  //   <a href="https://attack.mitre.org/groups/G0034/">...</a>
  const ids: string[] = [];
  const re = /href=["'](?:https?:\/\/attack\.mitre\.org)?\/groups\/(G\d{4})\/?["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (id) ids.push(id);
  }
  return uniq(ids);
}

