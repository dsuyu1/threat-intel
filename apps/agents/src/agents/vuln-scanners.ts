/**
 * VulnScannerSyncAgent — pulls vulnerability scan results and caches per-CVE exposure.
 *
 * Goal: turn "this CVE exists" into "this CVE exists AND you have N affected hosts".
 *
 * Run:  pnpm tsx src/agents/vuln-scanners.ts
 * Cron: every 6 hours via AWS EventBridge
 */

import "../lib/env.js";
import crypto from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  getDb,
  vulnScannerAssetCves,
  vulnScannerAssets,
  vulnScannerConnections,
  vulnScannerCveExposures,
} from "@ti/db";
import { decryptSecret } from "../lib/secretbox.js";

type ScannerKind = "tenable" | "qualys" | "rapid7" | "openvas";

type ConnectionRow = {
  id: string;
  projectId: string;
  kind: ScannerKind;
  name: string;
  baseUrl: string;
  credentialsEnc: string;
  lastSyncedAt: Date | null;
};

type AssetInput = {
  assetKey: string;
  externalId: string | null;
  hostname: string | null;
  ipv4: string | null;
  os: string | null;
  lastSeenAt: Date | null;
  rawJson: unknown;
};

type AssetCveInput = {
  assetKey: string;
  cveId: string;
  scannerVulnId: string | null;
  severity: string | null;
  status: "open" | "fixed" | "unknown";
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  rawJson: unknown;
};

type SyncResult = {
  assets: Map<string, AssetInput>;
  assetCves: Map<string, AssetCveInput>; // key = `${assetKey}::${cveId}`
  touchedCveIds: Set<string>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${pathname}`;
  } catch {
    return null;
  }
}

function computeSince(lastSyncedAt: Date | null) {
  const now = new Date();
  if (lastSyncedAt) return new Date(lastSyncedAt.getTime() - 60 * 60 * 1000); // 1h buffer
  return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90d initial backfill
}

function toUnixSeconds(d: Date) {
  return Math.floor(d.getTime() / 1000);
}

export function normalizeCveId(input: unknown) {
  const s = String(input ?? "").trim().toUpperCase();
  const m = s.match(/CVE-\d{4}-\d{4,7}/);
  return m?.[0] ?? null;
}

export function normalizeStatus(input: unknown): "open" | "fixed" | "unknown" {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "open" || s === "reopened" || s === "active" || s === "vulnerable") return "open";
  if (s === "fixed" || s === "resolved" || s === "closed" || s === "remediated" || s === "notvulnerable") return "fixed";
  return "unknown";
}

export function parseDateLike(input: unknown): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;

  if (typeof input === "number" && Number.isFinite(input)) {
    // Heuristic: treat <= 10^10 as seconds, else ms.
    const ms = input < 10_000_000_000 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(input).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && s.length >= 9) {
    const ms = n < 10_000_000_000 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickAssetKey(params: { kind: ScannerKind; externalId?: unknown; hostname?: unknown; ipv4?: unknown; raw?: unknown }) {
  const ext = String(params.externalId ?? "").trim();
  if (ext) return `${params.kind}:${ext}`;
  const ip = String(params.ipv4 ?? "").trim();
  if (ip) return `${params.kind}:ipv4:${ip}`;
  const host = String(params.hostname ?? "").trim();
  if (host) return `${params.kind}:host:${host.toLowerCase()}`;
  const hash = crypto.createHash("sha1").update(JSON.stringify(params.raw ?? {})).digest("hex");
  return `${params.kind}:hash:${hash}`;
}

function takeMaxDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function takeMinDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function parseJsonArrayOrLines(text: string): any[] {
  const s = String(text ?? "").trim();
  if (!s) return [];
  const asJson = safeJsonParse(s);
  if (Array.isArray(asJson)) return asJson;
  if (asJson && typeof asJson === "object") {
    // Some APIs wrap in { items: [...] }
    const items = (asJson as any).items;
    if (Array.isArray(items)) return items;
  }

  // NDJSON fallback
  const out: any[] = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const obj = safeJsonParse(t);
    if (obj) out.push(obj);
  }
  return out;
}

async function tenableRequestExport(params: { baseUrl: string; accessKey: string; secretKey: string; since: Date }) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Tenable baseUrl must be a valid http(s) URL");

  const url = new URL("/vulns/export", baseUrl);
  const body = {
    num_assets: 1000,
    filters: {
      since: toUnixSeconds(params.since),
      state: ["OPEN", "REOPENED", "FIXED"],
    },
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-ApiKeys": `accessKey=${params.accessKey}; secretKey=${params.secretKey}`,
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Tenable export request failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }

  const json = safeJsonParse(text) ?? {};
  const uuid = String((json as any).export_uuid ?? "").trim();
  if (!uuid) throw new Error("Tenable export request did not return export_uuid");
  return uuid;
}

async function tenableExportStatus(params: { baseUrl: string; accessKey: string; secretKey: string; exportUuid: string }) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Tenable baseUrl must be a valid http(s) URL");

  const url = new URL(`/vulns/export/${encodeURIComponent(params.exportUuid)}/status`, baseUrl);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-ApiKeys": `accessKey=${params.accessKey}; secretKey=${params.secretKey}`,
      accept: "application/json",
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Tenable export status failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }
  const json = safeJsonParse(text) ?? {};
  return json as any;
}

async function tenableDownloadChunk(params: {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
  exportUuid: string;
  chunkId: number;
}) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Tenable baseUrl must be a valid http(s) URL");

  const url = new URL(
    `/vulns/export/${encodeURIComponent(params.exportUuid)}/chunks/${encodeURIComponent(String(params.chunkId))}`,
    baseUrl
  );

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-ApiKeys": `accessKey=${params.accessKey}; secretKey=${params.secretKey}`,
      accept: "application/json",
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Tenable export chunk failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }
  return parseJsonArrayOrLines(text);
}

export function tenableExtract(records: any[]): SyncResult {
  const assets = new Map<string, AssetInput>();
  const assetCves = new Map<string, AssetCveInput>();
  const touchedCveIds = new Set<string>();

  for (const r of records) {
    const asset = (r as any)?.asset ?? {};
    const plugin = (r as any)?.plugin ?? {};

    const externalId = String(asset.uuid ?? asset.id ?? asset.asset_uuid ?? asset.asset_id ?? "").trim() || null;
    const hostname =
      String(asset.hostname ?? asset.fqdn ?? asset.netbios_name ?? asset.dns_name ?? "").trim() || null;
    const ipv4 = String(asset.ipv4 ?? asset.ip ?? asset.ipv4_address ?? "").trim() || null;

    const osRaw = asset.operating_system ?? asset.os;
    const os =
      Array.isArray(osRaw) ? osRaw.map(String).filter(Boolean).join(", ").slice(0, 200) : String(osRaw ?? "").trim() || null;

    const lastSeenAt = parseDateLike((r as any)?.last_found ?? (r as any)?.lastSeen ?? (asset as any)?.last_seen) ?? null;
    const assetKey = pickAssetKey({ kind: "tenable", externalId, hostname, ipv4, raw: asset });

    const prev = assets.get(assetKey);
    assets.set(assetKey, {
      assetKey,
      externalId,
      hostname,
      ipv4,
      os,
      lastSeenAt: takeMaxDate(prev?.lastSeenAt ?? null, lastSeenAt),
      rawJson: asset,
    });

    const state = (r as any)?.state ?? (r as any)?.status ?? null;
    const status = normalizeStatus(state);
    const scannerVulnId = String(plugin.id ?? (r as any)?.plugin_id ?? "").trim() || null;

    const firstSeenAt = parseDateLike((r as any)?.first_found ?? (r as any)?.firstSeen) ?? null;
    const edgeLastSeenAt = parseDateLike((r as any)?.last_found ?? (r as any)?.lastSeen) ?? lastSeenAt;

    const sev = String((r as any)?.severity ?? plugin.severity ?? "").trim() || null;

    const cvesRaw = plugin.cve ?? plugin.cves ?? (r as any)?.cve ?? (r as any)?.cves ?? null;
    const cvesArr: unknown[] =
      Array.isArray(cvesRaw) ? cvesRaw : typeof cvesRaw === "string" ? cvesRaw.split(/[, ]+/) : [];

    for (const c of cvesArr) {
      const cveId = normalizeCveId(c);
      if (!cveId) continue;
      touchedCveIds.add(cveId);

      const key = `${assetKey}::${cveId}`;
      const prevEdge = assetCves.get(key);
      assetCves.set(key, {
        assetKey,
        cveId,
        scannerVulnId,
        severity: sev,
        status,
        firstSeenAt: prevEdge?.firstSeenAt ?? firstSeenAt,
        lastSeenAt: takeMaxDate(prevEdge?.lastSeenAt ?? null, edgeLastSeenAt),
        rawJson: r,
      });
    }
  }

  return { assets, assetCves, touchedCveIds };
}

function basicAuthHeader(username: string, password: string) {
  const u = String(username ?? "");
  const p = String(password ?? "");
  const token = Buffer.from(`${u}:${p}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function extractXmlTag(xml: string, tag: string) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1] ?? null;
}

function extractAllXmlTags(xml: string, tag: string) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(m[1] ?? "");
  }
  return out;
}

function extractXmlNodes(xml: string, tag: string) {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: Array<{ attrs: string; inner: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push({ attrs: m[1] ?? "", inner: m[2] ?? "" });
  }
  return out;
}

function stripXmlTags(xml: string) {
  return String(xml ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinUrlPath(baseUrl: string, path: string) {
  const u = new URL(baseUrl);
  const basePath = u.pathname.replace(/\/+$/, "");
  const child = String(path ?? "").replace(/^\/+/, "");
  u.pathname = `${basePath}/${child}`.replace(/\/+/g, "/");
  u.search = "";
  u.hash = "";
  return u;
}

function cookieHeaderFromSetCookies(setCookies: string[]) {
  const parts: string[] = [];
  for (const sc of setCookies) {
    const p = String(sc ?? "").split(";")[0]?.trim();
    if (p) parts.push(p);
  }
  return parts.join("; ");
}

async function openvasLogin(params: { baseUrl: string; username: string; password: string }) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("OpenVAS baseUrl must be a valid http(s) URL");

  const body = new URLSearchParams({ login: params.username, password: params.password }).toString();

  const tryLogin = async (endpoint: "login" | "gmp") => {
    const url = joinUrlPath(baseUrl, endpoint);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/xml, text/xml, */*" },
      body: endpoint === "login" ? body : `cmd=login&${body}`,
    });

    const setCookies =
      ((res.headers as any).getSetCookie?.() as string[] | undefined) ??
      (res.headers.get("set-cookie") ? [String(res.headers.get("set-cookie"))] : []);

    const cookie = cookieHeaderFromSetCookies(setCookies);
    const text = await res.text().catch(() => "");

    // Some setups return JSON; most return an XML envelope with <token>.
    const json = safeJsonParse(text);
    const token = (json && typeof json === "object" ? String((json as any).token ?? "").trim() : "") || (extractXmlTag(text, "token") ?? "").trim();

    return { ok: res.ok, status: res.status, token: token || null, cookie: cookie || null, text };
  };

  // Newer GSAD versions use /login; older use POST /gmp cmd=login.
  const a = await tryLogin("login");
  if (a.ok && a.token) return { baseUrl, token: a.token, cookie: a.cookie };
  if (a.status === 404 || a.status === 405) {
    const b = await tryLogin("gmp");
    if (b.ok && b.token) return { baseUrl, token: b.token, cookie: b.cookie };
    throw new Error(`OpenVAS login failed (HTTP ${b.status}): ${b.text.slice(0, 240)}`);
  }

  throw new Error(`OpenVAS login failed (HTTP ${a.status}): ${a.text.slice(0, 240)}`);
}

async function openvasGmp(
  params: { baseUrl: string; token: string; cookie: string | null },
  cmd: string,
  qs?: Record<string, string>
) {
  const url = joinUrlPath(params.baseUrl, "gmp");
  url.searchParams.set("cmd", cmd);
  url.searchParams.set("token", params.token);
  for (const [k, v] of Object.entries(qs ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = { accept: "application/xml, text/xml, */*" };
  if (params.cookie) headers.cookie = params.cookie;

  const res = await fetch(url.toString(), { method: "GET", headers });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`OpenVAS GMP ${cmd} failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }
  return text;
}

export function openvasExtract(xml: string, opts: { since: Date }): SyncResult & { meta: { resultsTotal: number; oldestSeenAt: Date | null } } {
  const assets = new Map<string, AssetInput>();
  const assetCves = new Map<string, AssetCveInput>();
  const touchedCveIds = new Set<string>();

  const since = opts.since;

  let resultsTotal = 0;
  let oldestSeenAt: Date | null = null;

  const resultNodes = extractXmlNodes(xml, "result");
  resultsTotal = resultNodes.length;

  for (const n of resultNodes) {
    const inner = n.inner;

    const modificationTime = extractXmlTag(inner, "modification_time") ?? extractXmlTag(inner, "creation_time") ?? extractXmlTag(inner, "timestamp");
    const seenAt = parseDateLike(modificationTime) ?? null;

    if (seenAt && (!oldestSeenAt || seenAt.getTime() < oldestSeenAt.getTime())) oldestSeenAt = seenAt;
    if (seenAt && seenAt.getTime() < since.getTime()) continue;

    const cveMatches = inner.match(/CVE-\d{4}-\d{4,7}/gi) ?? [];
    const cveIds = Array.from(new Set(cveMatches.map(normalizeCveId).filter(Boolean) as string[]));
    if (!cveIds.length) continue;

    const hostBlock = extractXmlTag(inner, "host") ?? "";
    const ip = (extractXmlTag(hostBlock, "ip") ?? "").trim();
    const hostText = ip || stripXmlTags(hostBlock);
    const hostnameRaw = (extractXmlTag(hostBlock, "hostname") ?? extractXmlTag(inner, "hostname") ?? "").trim();

    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostText) ? hostText : null;
    const hostname = hostnameRaw || (!ipv4 && hostText ? hostText : null);

    const nvtOid = inner.match(/<nvt\b[^>]*\boid="([^"]+)"/i)?.[1]?.trim() || null;
    const severity = (extractXmlTag(inner, "severity") ?? "").trim() || null;

    const assetKey = pickAssetKey({
      kind: "openvas",
      externalId: null,
      hostname,
      ipv4,
      raw: hostText || inner.slice(0, 2000),
    });

    const prevAsset = assets.get(assetKey);
    assets.set(assetKey, {
      assetKey,
      externalId: null,
      hostname: hostname ?? prevAsset?.hostname ?? null,
      ipv4: ipv4 ?? prevAsset?.ipv4 ?? null,
      os: null,
      lastSeenAt: takeMaxDate(prevAsset?.lastSeenAt ?? null, seenAt),
      rawJson: { kind: "openvas", host: hostText || null, nvtOid, severity, sample: inner.slice(0, 2000) },
    });

    for (const cveId of cveIds) {
      touchedCveIds.add(cveId);
      const key = `${assetKey}::${cveId}`;
      const prev = assetCves.get(key);
      assetCves.set(key, {
        assetKey,
        cveId,
        scannerVulnId: nvtOid ?? prev?.scannerVulnId ?? null,
        severity: severity ?? prev?.severity ?? null,
        status: "open",
        firstSeenAt: prev?.firstSeenAt ?? seenAt,
        lastSeenAt: takeMaxDate(prev?.lastSeenAt ?? null, seenAt),
        rawJson: { resultId: n.attrs.match(/\bid="([^"]+)"/i)?.[1] ?? null, nvtOid, severity },
      });
    }
  }

  return { assets, assetCves, touchedCveIds, meta: { resultsTotal, oldestSeenAt } };
}

async function openvasFetchSince(params: { baseUrl: string; username: string; password: string; since: Date }) {
  const auth = await openvasLogin({ baseUrl: params.baseUrl, username: params.username, password: params.password });

  const assets = new Map<string, AssetInput>();
  const assetCves = new Map<string, AssetCveInput>();
  const touchedCveIds = new Set<string>();

  const pageSize = 500;
  const maxPages = 12;
  let first = 1;

  for (let page = 0; page < maxPages; page++) {
    const filter = `first=${first} rows=${pageSize} sort-reverse=created min_qod=0`;
    const xml = await openvasGmp({ baseUrl: auth.baseUrl, token: auth.token, cookie: auth.cookie }, "get_results", {
      details: "1",
      filter,
    });

    const parsed = openvasExtract(xml, { since: params.since });

    for (const [k, a] of parsed.assets) {
      const prev = assets.get(k);
      assets.set(
        k,
        prev
          ? {
              ...prev,
              ...a,
              externalId: prev.externalId ?? a.externalId,
              hostname: prev.hostname ?? a.hostname,
              ipv4: prev.ipv4 ?? a.ipv4,
              os: prev.os ?? a.os,
              lastSeenAt: takeMaxDate(prev.lastSeenAt, a.lastSeenAt),
            }
          : a
      );
    }

    for (const [k, e] of parsed.assetCves) {
      const prev = assetCves.get(k);
      assetCves.set(
        k,
        prev
          ? {
              ...e,
              scannerVulnId: e.scannerVulnId ?? prev.scannerVulnId,
              severity: e.severity ?? prev.severity,
              firstSeenAt: takeMinDate(prev.firstSeenAt, e.firstSeenAt),
              lastSeenAt: takeMaxDate(prev.lastSeenAt, e.lastSeenAt),
            }
          : e
      );
    }

    for (const cveId of parsed.touchedCveIds) touchedCveIds.add(cveId);

    if (parsed.meta.resultsTotal < pageSize) break;
    if (parsed.meta.oldestSeenAt && parsed.meta.oldestSeenAt.getTime() < params.since.getTime()) break;

    first += pageSize;
  }

  return { assets, assetCves, touchedCveIds } satisfies SyncResult;
}

async function qualysFetchDetections(params: {
  baseUrl: string;
  username: string;
  password: string;
  since: Date;
  maxHosts: number;
}) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Qualys baseUrl must be a valid http(s) URL");

  const url = new URL("/api/2.0/fo/asset/host/vm/detection/", baseUrl);
  // Best-effort: Qualys APIs are legacy XML. We keep the query minimal and parse a subset.
  url.searchParams.set("action", "list");
  url.searchParams.set("truncation_limit", String(Math.max(100, Math.min(params.maxHosts, 2000))));
  url.searchParams.set("include_ignored", "0");
  url.searchParams.set("show_reopened_info", "1");
  url.searchParams.set("show_results", "1");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(params.username, params.password),
      accept: "application/xml, text/xml, */*",
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Qualys host detection list failed (HTTP ${res.status}): ${text.slice(0, 600)}`);
  }

  return text;
}

export function qualysExtract(xml: string): SyncResult {
  const assets = new Map<string, AssetInput>();
  const assetCves = new Map<string, AssetCveInput>();
  const touchedCveIds = new Set<string>();

  const hosts = extractAllXmlTags(xml, "HOST");
  for (const hostXml of hosts) {
    const externalId = extractXmlTag(hostXml, "ID")?.trim() || null;
    const hostname = (extractXmlTag(hostXml, "DNS") || extractXmlTag(hostXml, "NETBIOS") || "").trim() || null;
    const ipv4 = (extractXmlTag(hostXml, "IP") || "").trim() || null;
    const os = extractXmlTag(hostXml, "OS")?.trim() || null;

    const assetKey = pickAssetKey({ kind: "qualys", externalId, hostname, ipv4, raw: hostXml.slice(0, 2000) });

    const detectionsBlock = extractXmlTag(hostXml, "DETECTION_LIST") ?? "";
    const detections = extractAllXmlTags(detectionsBlock, "DETECTION");

    let assetLastSeen: Date | null = null;

    for (const detXml of detections) {
      const status = normalizeStatus(extractXmlTag(detXml, "STATUS") ?? extractXmlTag(detXml, "STATE"));
      const qid = extractXmlTag(detXml, "QID")?.trim() || null;
      const severity = extractXmlTag(detXml, "SEVERITY")?.trim() || null;
      const firstSeenAt = parseDateLike(extractXmlTag(detXml, "FIRST_FOUND_DATETIME") ?? extractXmlTag(detXml, "FIRST_FOUND")) ?? null;
      const lastSeenAt = parseDateLike(extractXmlTag(detXml, "LAST_FOUND_DATETIME") ?? extractXmlTag(detXml, "LAST_FOUND")) ?? null;
      assetLastSeen = takeMaxDate(assetLastSeen, lastSeenAt);

      const cveListBlock = extractXmlTag(detXml, "CVE_ID_LIST") ?? "";
      const cves = extractAllXmlTags(cveListBlock, "CVE_ID");
      for (const cve of cves) {
        const cveId = normalizeCveId(cve);
        if (!cveId) continue;
        touchedCveIds.add(cveId);

        const key = `${assetKey}::${cveId}`;
        const prev = assetCves.get(key);
        assetCves.set(key, {
          assetKey,
          cveId,
          scannerVulnId: qid,
          severity,
          status,
          firstSeenAt: prev?.firstSeenAt ?? firstSeenAt,
          lastSeenAt: takeMaxDate(prev?.lastSeenAt ?? null, lastSeenAt),
          rawJson: detXml,
        });
      }
    }

    const prevAsset = assets.get(assetKey);
    assets.set(assetKey, {
      assetKey,
      externalId,
      hostname,
      ipv4,
      os,
      lastSeenAt: takeMaxDate(prevAsset?.lastSeenAt ?? null, assetLastSeen),
      rawJson: hostXml,
    });
  }

  return { assets, assetCves, touchedCveIds };
}

async function rapid7FetchVulnerabilities(params: {
  baseUrl: string;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  page: number;
  size: number;
}) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Rapid7 baseUrl must be a valid http(s) URL");

  const url = new URL("/api/3/vulnerabilities", baseUrl);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("size", String(params.size));

  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = String(params.apiKey ?? "").trim();
  if (apiKey) headers["X-Api-Key"] = apiKey;
  else if (params.username && params.password) headers["authorization"] = basicAuthHeader(params.username, params.password);

  const res = await fetch(url.toString(), { method: "GET", headers });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Rapid7 vulnerabilities list failed (HTTP ${res.status}): ${text.slice(0, 600)}`);

  const json = safeJsonParse(text);
  if (!json || typeof json !== "object") throw new Error("Rapid7 vulnerabilities list returned non-JSON");
  const resources = (json as any).resources;
  if (!Array.isArray(resources)) return [];
  return resources as any[];
}

async function rapid7FetchVulnerabilityAssets(params: {
  baseUrl: string;
  vulnId: string;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  page: number;
  size: number;
}) {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  if (!baseUrl) throw new Error("Rapid7 baseUrl must be a valid http(s) URL");

  const url = new URL(`/api/3/vulnerabilities/${encodeURIComponent(params.vulnId)}/assets`, baseUrl);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("size", String(params.size));

  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = String(params.apiKey ?? "").trim();
  if (apiKey) headers["X-Api-Key"] = apiKey;
  else if (params.username && params.password) headers["authorization"] = basicAuthHeader(params.username, params.password);

  const res = await fetch(url.toString(), { method: "GET", headers });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Rapid7 vulnerability assets failed (HTTP ${res.status}): ${text.slice(0, 600)}`);

  const json = safeJsonParse(text);
  if (!json || typeof json !== "object") throw new Error("Rapid7 vulnerability assets returned non-JSON");
  const resources = (json as any).resources;
  if (!Array.isArray(resources)) return [];
  return resources as any[];
}

function rapid7Extract(params: { vulns: any[]; assetsByVulnId: Map<string, any[]> }): SyncResult {
  const assets = new Map<string, AssetInput>();
  const assetCves = new Map<string, AssetCveInput>();
  const touchedCveIds = new Set<string>();

  for (const v of params.vulns) {
    const vulnId = String(v?.id ?? v?.vulnerabilityId ?? "").trim();
    if (!vulnId) continue;

    const cvesRaw = v?.cves ?? v?.cve ?? v?.cveIds ?? [];
    const cvesArr: unknown[] =
      Array.isArray(cvesRaw) ? cvesRaw : typeof cvesRaw === "string" ? cvesRaw.split(/[, ]+/) : [];
    const cveIds = cvesArr.map(normalizeCveId).filter(Boolean) as string[];
    if (!cveIds.length) continue;

    const vulnAssets = params.assetsByVulnId.get(vulnId) ?? [];
    for (const a of vulnAssets) {
      const externalId = String(a?.id ?? a?.assetId ?? a?.uuid ?? "").trim() || null;
      const hostname = String(a?.hostname ?? a?.hostName ?? a?.fqdn ?? "").trim() || null;
      const ipv4 = String(a?.ip ?? a?.ipAddress ?? a?.ipv4 ?? "").trim() || null;
      const os = String(a?.os ?? a?.operatingSystem ?? "").trim() || null;

      const assetKey = pickAssetKey({ kind: "rapid7", externalId, hostname, ipv4, raw: a });
      const prev = assets.get(assetKey);

      const lastSeenAt = parseDateLike(a?.lastSeen ?? a?.last_assessed_for_vulnerabilities ?? a?.assessedForVulnerabilitiesAt) ?? null;

      assets.set(assetKey, {
        assetKey,
        externalId,
        hostname,
        ipv4,
        os,
        lastSeenAt: takeMaxDate(prev?.lastSeenAt ?? null, lastSeenAt),
        rawJson: a,
      });

      for (const cveId of cveIds) {
        touchedCveIds.add(cveId);
        const key = `${assetKey}::${cveId}`;
        const prevEdge = assetCves.get(key);
        assetCves.set(key, {
          assetKey,
          cveId,
          scannerVulnId: vulnId,
          severity: String(v?.severity ?? v?.riskScore ?? "").trim() || null,
          status: normalizeStatus(v?.status ?? v?.state),
          firstSeenAt: prevEdge?.firstSeenAt ?? parseDateLike(v?.firstDiscovered ?? v?.first_discovered) ?? null,
          lastSeenAt: takeMaxDate(prevEdge?.lastSeenAt ?? null, parseDateLike(v?.lastDiscovered ?? v?.last_discovered) ?? lastSeenAt),
          rawJson: v,
        });
      }
    }
  }

  return { assets, assetCves, touchedCveIds };
}

async function upsertAssetsAndEdges(params: {
  projectId: string;
  connectionId: string;
  assets: Map<string, AssetInput>;
  edges: Map<string, AssetCveInput>;
}) {
  const db = getDb();
  const now = new Date();

  const assetRows = Array.from(params.assets.values()).map((a) => ({
    projectId: params.projectId,
    connectionId: params.connectionId,
    externalId: a.externalId,
    assetKey: a.assetKey,
    hostname: a.hostname,
    ipv4: a.ipv4,
    os: a.os,
    lastSeenAt: a.lastSeenAt,
    rawJson: a.rawJson as any,
    createdAt: now,
    updatedAt: now,
  }));

  const assetKeyToId = new Map<string, string>();

  if (assetRows.length) {
    const returned = await db
      .insert(vulnScannerAssets)
      .values(assetRows as any)
      .onConflictDoUpdate({
        target: [vulnScannerAssets.connectionId, vulnScannerAssets.assetKey],
        set: {
          externalId: sql`excluded.external_id`,
          hostname: sql`excluded.hostname`,
          ipv4: sql`excluded.ipv4`,
          os: sql`excluded.os`,
          lastSeenAt: sql`excluded.last_seen_at`,
          rawJson: sql`excluded.raw_json`,
          updatedAt: now,
        },
      })
      .returning({ id: vulnScannerAssets.id, assetKey: vulnScannerAssets.assetKey });

    for (const r of returned) assetKeyToId.set(r.assetKey, r.id);
  }

  const edgeRows = Array.from(params.edges.values())
    .map((e) => {
      const assetId = assetKeyToId.get(e.assetKey);
      if (!assetId) return null;
      return {
        projectId: params.projectId,
        connectionId: params.connectionId,
        assetId,
        cveId: e.cveId,
        scannerVulnId: e.scannerVulnId,
        severity: e.severity,
        status: e.status,
        firstSeenAt: e.firstSeenAt,
        lastSeenAt: e.lastSeenAt,
        rawJson: e.rawJson as any,
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter(Boolean) as any[];

  if (edgeRows.length) {
    await db
      .insert(vulnScannerAssetCves)
      .values(edgeRows as any)
      .onConflictDoUpdate({
        target: [vulnScannerAssetCves.assetId, vulnScannerAssetCves.cveId],
        set: {
          scannerVulnId: sql`excluded.scanner_vuln_id`,
          severity: sql`excluded.severity`,
          status: sql`excluded.status`,
          firstSeenAt: sql`excluded.first_seen_at`,
          lastSeenAt: sql`excluded.last_seen_at`,
          rawJson: sql`excluded.raw_json`,
          updatedAt: now,
        },
      });
  }

  return { assetsUpserted: assetRows.length, edgesUpserted: edgeRows.length };
}

async function recomputeExposures(params: { projectId: string; connectionId: string; cveIds: string[] }) {
  const db = getDb();
  const now = new Date();
  const activeSince = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

  if (!params.cveIds.length) return { exposuresUpserted: 0 };

  const agg = await db
    .select({
      cveId: vulnScannerAssetCves.cveId,
      affectedHostCount: sql<number>`count(distinct ${vulnScannerAssetCves.assetId})`,
      lastSeenAt: sql<Date | null>`max(${vulnScannerAssetCves.lastSeenAt})`,
    })
    .from(vulnScannerAssetCves)
    .where(
      and(
        eq(vulnScannerAssetCves.projectId, params.projectId),
        eq(vulnScannerAssetCves.connectionId, params.connectionId),
        inArray(vulnScannerAssetCves.cveId, params.cveIds),
        gte(vulnScannerAssetCves.lastSeenAt, activeSince),
        sql`${vulnScannerAssetCves.status} != 'fixed'`
      )
    )
    .groupBy(vulnScannerAssetCves.cveId);

  const byCve = new Map<string, { affectedHostCount: number; lastSeenAt: Date | null; sampleHostsJson: unknown[] }>();

  for (const r of agg) {
    byCve.set(r.cveId, {
      affectedHostCount: Number(r.affectedHostCount ?? 0),
      lastSeenAt: r.lastSeenAt ?? null,
      sampleHostsJson: [],
    });
  }

  // Sample hosts (<=10) for each CVE to power a lightweight drilldown.
  for (const cveId of Array.from(byCve.keys())) {
    const rows = await db
      .select({
        hostname: vulnScannerAssets.hostname,
        ipv4: vulnScannerAssets.ipv4,
        lastSeenAt: vulnScannerAssetCves.lastSeenAt,
      })
      .from(vulnScannerAssetCves)
      .innerJoin(vulnScannerAssets, eq(vulnScannerAssetCves.assetId, vulnScannerAssets.id))
      .where(
        and(
          eq(vulnScannerAssetCves.projectId, params.projectId),
          eq(vulnScannerAssetCves.connectionId, params.connectionId),
          eq(vulnScannerAssetCves.cveId, cveId),
          gte(vulnScannerAssetCves.lastSeenAt, activeSince),
          sql`${vulnScannerAssetCves.status} != 'fixed'`
        )
      )
      .orderBy(desc(vulnScannerAssetCves.lastSeenAt))
      .limit(10);

    byCve.set(cveId, {
      affectedHostCount: byCve.get(cveId)!.affectedHostCount,
      lastSeenAt: byCve.get(cveId)!.lastSeenAt,
      sampleHostsJson: rows.map((r) => ({
        hostname: r.hostname ?? null,
        ipv4: r.ipv4 ?? null,
        lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
      })),
    });
  }

  const exposureRows = Array.from(byCve.entries()).map(([cveId, v]) => ({
    projectId: params.projectId,
    connectionId: params.connectionId,
    cveId,
    affectedHostCount: v.affectedHostCount,
    lastSeenAt: v.lastSeenAt,
    sampleHostsJson: v.sampleHostsJson as any,
    computedAt: now,
  }));

  if (!exposureRows.length) return { exposuresUpserted: 0 };

  await db
    .insert(vulnScannerCveExposures)
    .values(exposureRows as any)
    .onConflictDoUpdate({
      target: [vulnScannerCveExposures.projectId, vulnScannerCveExposures.connectionId, vulnScannerCveExposures.cveId],
      set: {
        affectedHostCount: sql`excluded.affected_host_count`,
        lastSeenAt: sql`excluded.last_seen_at`,
        sampleHostsJson: sql`excluded.sample_hosts_json`,
        computedAt: now,
      },
    });

  return { exposuresUpserted: exposureRows.length };
}

async function syncConnection(c: ConnectionRow): Promise<{ cvesTouched: Set<string>; assetsUpserted: number; edgesUpserted: number; exposuresUpserted: number }> {
  const db = getDb();

  let credsRaw: string;
  try {
    credsRaw = await decryptSecret(c.credentialsEnc);
  } catch (err) {
    throw new Error(`Failed to decrypt credentials for ${c.name}: ${String((err as any)?.message ?? err ?? "")}`);
  }
  const creds = safeJsonParse(credsRaw) ?? {};

  const since = computeSince(c.lastSyncedAt);
  let result: SyncResult;

  if (c.kind === "tenable") {
    const accessKey = String((creds as any).accessKey ?? "").trim();
    const secretKey = String((creds as any).secretKey ?? "").trim();
    if (!accessKey || !secretKey) throw new Error("Tenable credentials require accessKey and secretKey");

    const exportUuid = await tenableRequestExport({ baseUrl: c.baseUrl, accessKey, secretKey, since });

    const maxPolls = 40;
    let status: any = null;
    for (let i = 0; i < maxPolls; i++) {
      status = await tenableExportStatus({ baseUrl: c.baseUrl, accessKey, secretKey, exportUuid });
      const st = String(status?.status ?? "").toUpperCase();
      if (st === "FINISHED") break;
      if (st === "ERROR") throw new Error(`Tenable export failed: ${JSON.stringify(status).slice(0, 800)}`);
      await sleep(2500);
    }

    const finalStatus = String(status?.status ?? "").toUpperCase();
    if (finalStatus !== "FINISHED") {
      throw new Error(`Tenable export did not finish before timeout (status=${finalStatus || "unknown"})`);
    }

    const chunks: number[] = Array.isArray(status?.chunks_available) ? status.chunks_available.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    if (!chunks.length) {
      result = { assets: new Map(), assetCves: new Map(), touchedCveIds: new Set() };
    } else {
      const maxChunks = 10; // cap per run to avoid unbounded Lambda time
      const records: any[] = [];
      for (const chunkId of chunks.slice(0, maxChunks)) {
        const chunk = await tenableDownloadChunk({ baseUrl: c.baseUrl, accessKey, secretKey, exportUuid, chunkId });
        records.push(...chunk);
      }
      result = tenableExtract(records);
    }
  } else if (c.kind === "qualys") {
    const username = String((creds as any).username ?? "").trim();
    const password = String((creds as any).password ?? "");
    if (!username || !password) throw new Error("Qualys credentials require username and password");
    const xml = await qualysFetchDetections({ baseUrl: c.baseUrl, username, password, since, maxHosts: 2000 });
    result = qualysExtract(xml);
  } else if (c.kind === "rapid7") {
    const apiKey = String((creds as any).apiKey ?? "").trim() || null;
    const username = String((creds as any).username ?? "").trim() || null;
    const password = String((creds as any).password ?? "") || null;
    if (!apiKey && !(username && password)) {
      throw new Error("Rapid7 credentials require apiKey OR username/password");
    }

    const vulns: any[] = [];
    const assetsByVulnId = new Map<string, any[]>();

    const pageSize = 50;
    const maxPages = 6;

    for (let page = 0; page < maxPages; page++) {
      const pageVulns = await rapid7FetchVulnerabilities({ baseUrl: c.baseUrl, apiKey, username, password, page, size: pageSize });
      if (!pageVulns.length) break;
      vulns.push(...pageVulns);
    }

    const maxVulns = 120;
    for (const v of vulns.slice(0, maxVulns)) {
      const vulnId = String(v?.id ?? v?.vulnerabilityId ?? "").trim();
      if (!vulnId) continue;

      const assets: any[] = [];
      for (let page = 0; page < 3; page++) {
        const pageAssets = await rapid7FetchVulnerabilityAssets({
          baseUrl: c.baseUrl,
          vulnId,
          apiKey,
          username,
          password,
          page,
          size: 200,
        });
        if (!pageAssets.length) break;
        assets.push(...pageAssets);
      }
      assetsByVulnId.set(vulnId, assets);
    }

    result = rapid7Extract({ vulns, assetsByVulnId });
  } else if (c.kind === "openvas") {
    const username = String((creds as any).username ?? "").trim();
    const password = String((creds as any).password ?? "");
    if (!username || !password) throw new Error("OpenVAS credentials require username and password");

    result = await openvasFetchSince({ baseUrl: c.baseUrl, username, password, since });
  } else {
    throw new Error(`Unsupported scanner kind: ${c.kind}`);
  }

  const upserted = await upsertAssetsAndEdges({
    projectId: c.projectId,
    connectionId: c.id,
    assets: result.assets,
    edges: result.assetCves,
  });

  const cveIds = Array.from(result.touchedCveIds);
  const cappedCveIds = cveIds.slice(0, 400);
  const { exposuresUpserted } = await recomputeExposures({ projectId: c.projectId, connectionId: c.id, cveIds: cappedCveIds });

  await db
    .update(vulnScannerConnections)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(vulnScannerConnections.id, c.id), eq(vulnScannerConnections.projectId, c.projectId)));

  return {
    cvesTouched: result.touchedCveIds,
    assetsUpserted: upserted.assetsUpserted,
    edgesUpserted: upserted.edgesUpserted,
    exposuresUpserted,
  };
}

export async function runVulnScannerSyncAgent(params?: { connectionId?: string | null }) {
  const db = getDb();
  const onlyId = String(params?.connectionId ?? "").trim();

  let connections: ConnectionRow[] = [];
  try {
    connections = await db
      .select({
        id: vulnScannerConnections.id,
        projectId: vulnScannerConnections.projectId,
        kind: vulnScannerConnections.kind,
        name: vulnScannerConnections.name,
        baseUrl: vulnScannerConnections.baseUrl,
        credentialsEnc: vulnScannerConnections.credentialsEnc,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
      })
      .from(vulnScannerConnections)
      .where(and(eq(vulnScannerConnections.enabled, true), onlyId ? eq(vulnScannerConnections.id, onlyId) : undefined))
      .orderBy(desc(vulnScannerConnections.updatedAt))
      .limit(200);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") {
      console.log("[VulnScannerSyncAgent] Tables missing; run migrations.");
      return { connectionsProcessed: 0, assetsUpserted: 0, edgesUpserted: 0, exposuresUpserted: 0, cvesTouched: 0 };
    }
    throw err;
  }

  if (!connections.length) {
    console.log("[VulnScannerSyncAgent] No enabled connections.");
    return { connectionsProcessed: 0, assetsUpserted: 0, edgesUpserted: 0, exposuresUpserted: 0, cvesTouched: 0 };
  }

  let assetsUpserted = 0;
  let edgesUpserted = 0;
  let exposuresUpserted = 0;
  const cvesTouched = new Set<string>();

  for (const c of connections) {
    console.log(`[VulnScannerSyncAgent] Syncing: ${c.name} (${c.kind})`);
    try {
      const r = await syncConnection(c);
      assetsUpserted += r.assetsUpserted;
      edgesUpserted += r.edgesUpserted;
      exposuresUpserted += r.exposuresUpserted;
      for (const id of r.cvesTouched) cvesTouched.add(id);
    } catch (err) {
      console.warn(`[VulnScannerSyncAgent] Failed: ${c.name} (${c.kind})`, err);
    }
  }

  return {
    connectionsProcessed: connections.length,
    assetsUpserted,
    edgesUpserted,
    exposuresUpserted,
    cvesTouched: cvesTouched.size,
  };
}

if (process.argv[1]?.endsWith("vuln-scanners.ts")) {
  runVulnScannerSyncAgent().then((r) => {
    console.log(JSON.stringify(r));
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
