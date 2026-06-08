import "server-only";

export const API_SCOPES = [
  "actors:read",
  "cves:read",
  "query:run",
  "playbooks:write",
  "detections:generate",
  "findings:read",
  "navigator:read",
  "risk:read",
  "stix:read",
  "taxii:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

function base64UrlEncode(bytes: Uint8Array) {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateApiKeySecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = `ti_api_${base64UrlEncode(bytes)}`;
  const keyHash = await sha256Hex(secret);
  const keyPrefix = secret.slice(0, 14); // "ti_api_" + first 8 chars
  return { secret, keyHash, keyPrefix };
}

export function parseScopesJson(value: string | null): string[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function normalizeScopes(input: unknown): ApiScope[] {
  const arr = Array.isArray(input) ? input : [];
  const out: ApiScope[] = [];
  for (const raw of arr) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if ((API_SCOPES as readonly string[]).includes(v)) out.push(v as ApiScope);
  }
  return Array.from(new Set(out));
}
