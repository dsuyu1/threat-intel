export type IocKind = "ipv4" | "ipv6" | "domain" | "url" | "md5" | "sha1" | "sha256";

export type NormalizedIoc = {
  kind: IocKind;
  value: string;
  normalized: string;
};

export type NormalizeIocResult =
  | { ok: true; ioc: NormalizedIoc }
  | { ok: false; error: string };

function isHex(s: string) {
  return /^[0-9a-f]+$/i.test(s);
}

function normalizeIpv4(s: string): string | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets.join(".");
}

function looksLikeIpv6(s: string) {
  return s.includes(":");
}

function isValidIpv6(s: string): boolean {
  const raw = s.toLowerCase();
  if (!raw) return false;
  if (raw.includes("%")) return false; // zone id
  if (!/^[0-9a-f:.]+$/i.test(raw)) return false;
  if (!looksLikeIpv6(raw)) return false;

  const parts = raw.split("::");
  if (parts.length > 2) return false;

  const left = parts[0] ? parts[0].split(":").filter((x) => x.length > 0) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":").filter((x) => x.length > 0) : [];

  const all = [...left, ...right];
  if (all.length === 0) return true; // "::"

  const hasIpv4 = all.some((p) => p.includes("."));
  if (hasIpv4) {
    // Only the final segment may be IPv4.
    if (!all[all.length - 1]!.includes(".")) return false;
    const v4 = normalizeIpv4(all[all.length - 1]!);
    if (!v4) return false;
  }

  for (let i = 0; i < all.length; i++) {
    const seg = all[i]!;
    if (seg.includes(".")) continue; // validated above
    if (seg.length < 1 || seg.length > 4) return false;
    if (!isHex(seg)) return false;
  }

  const groupCount = all.length + (hasIpv4 ? 1 : 0); // IPv4 counts as 2 groups but currently counted as 1
  const effectiveGroups = hasIpv4 ? groupCount + 1 : groupCount;

  if (parts.length === 1) return effectiveGroups === 8;
  // RFC allows :: to compress at least one group; enforce < 8.
  return effectiveGroups < 8;
}

function normalizeIpv6(s: string): string | null {
  let raw = s.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  if (!isValidIpv6(raw)) return null;
  try {
    // WHATWG URL normalizes IPv6 in the host position.
    const u = new URL(`http://[${raw}]`);
    const host = u.hostname; // "[2001:db8::1]"
    if (!host.startsWith("[") || !host.endsWith("]")) return raw.toLowerCase();
    return host.slice(1, -1).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function normalizeDomain(s: string): string | null {
  const raw = s.trim().replace(/\.$/, "");
  if (!raw) return null;
  // Reject obvious URLs: domains should not contain slashes or schemes.
  if (raw.includes("/") || raw.includes("://")) return null;

  try {
    const u = new URL(`http://${raw}`);
    const host = u.hostname.replace(/\.$/, "");
    if (!host) return null;
    if (!host.includes(".")) return null;
    return host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeUrl(s: string): string | null {
  const raw = s.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeHash(s: string, expectedLen: number): string | null {
  const raw = s.trim();
  if (raw.length !== expectedLen) return null;
  if (!isHex(raw)) return null;
  return raw.toLowerCase();
}

export function detectIocKind(raw: string): IocKind | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const v4 = normalizeIpv4(s);
  if (v4) return "ipv4";

  const v6 = normalizeIpv6(s);
  if (v6) return "ipv6";

  if (/^[0-9a-f]+$/i.test(s)) {
    if (s.length === 32) return "md5";
    if (s.length === 40) return "sha1";
    if (s.length === 64) return "sha256";
  }

  if (s.includes("://")) {
    const u = normalizeUrl(s);
    if (u) return "url";
  }

  const d = normalizeDomain(s);
  if (d) return "domain";

  return null;
}

export function normalizeIoc(raw: string, kindHint?: IocKind | null): NormalizeIocResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "Empty value" };

  const kind = kindHint ?? detectIocKind(value);
  if (!kind) return { ok: false, error: "Unsupported IOC value" };

  const normalized =
    kind === "ipv4"
      ? normalizeIpv4(value)
      : kind === "ipv6"
        ? normalizeIpv6(value)
        : kind === "domain"
          ? normalizeDomain(value)
          : kind === "url"
            ? normalizeUrl(value)
            : kind === "md5"
              ? normalizeHash(value, 32)
              : kind === "sha1"
                ? normalizeHash(value, 40)
                : normalizeHash(value, 64);

  if (!normalized) return { ok: false, error: `Invalid ${kind} value` };

  return { ok: true, ioc: { kind, value, normalized } };
}

