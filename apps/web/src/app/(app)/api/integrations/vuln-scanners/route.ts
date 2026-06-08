export const runtime = "edge";

import { getDb, vulnScannerConnections } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../lib/local-user";
import { decryptSecret, encryptSecret } from "../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../lib/tenancy";

type ScannerKind = "tenable" | "qualys" | "rapid7" | "openvas";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function normalizeBaseUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${pathname}`;
  } catch {
    return null;
  }
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

function isScannerKind(v: string): v is ScannerKind {
  return v === "tenable" || v === "qualys" || v === "rapid7" || v === "openvas";
}

function cleanCredentials(kind: ScannerKind, raw: any) {
  const creds: Record<string, string> = {};

  if (kind === "tenable") {
    const accessKey = String(raw?.accessKey ?? "").trim();
    const secretKey = String(raw?.secretKey ?? "").trim();
    if (!accessKey) return { ok: false as const, error: "accessKey is required for Tenable" };
    if (!secretKey) return { ok: false as const, error: "secretKey is required for Tenable" };
    creds.accessKey = accessKey;
    creds.secretKey = secretKey;
  } else if (kind === "qualys") {
    const username = String(raw?.username ?? "").trim();
    const password = String(raw?.password ?? "");
    if (!username) return { ok: false as const, error: "username is required for Qualys" };
    if (!password) return { ok: false as const, error: "password is required for Qualys" };
    creds.username = username;
    creds.password = password;
  } else if (kind === "rapid7") {
    const apiKey = String(raw?.apiKey ?? "").trim();
    const username = String(raw?.username ?? "").trim();
    const password = String(raw?.password ?? "");
    if (apiKey) {
      creds.apiKey = apiKey;
    } else {
      if (!username) return { ok: false as const, error: "apiKey OR username is required for Rapid7" };
      if (!password) return { ok: false as const, error: "apiKey OR password is required for Rapid7" };
      creds.username = username;
      creds.password = password;
    }
  } else if (kind === "openvas") {
    const username = String(raw?.username ?? "").trim();
    const password = String(raw?.password ?? "");
    if (!username) return { ok: false as const, error: "username is required for OpenVAS" };
    if (!password) return { ok: false as const, error: "password is required for OpenVAS" };
    creds.username = username;
    creds.password = password;
  }

  return { ok: true as const, credentials: creds };
}

async function encryptCredentials(credentials: Record<string, string>) {
  const raw = JSON.stringify(credentials);
  const enc = await encryptSecret(raw);
  const roundtrip = await decryptSecret(enc);
  if (roundtrip !== raw) throw new Error("Encryption roundtrip failed");
  return enc;
}

export async function GET(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Vulnerability scanner integrations are available on Pro." }, { status: 403 });

  try {
    const rows = await db
      .select({
        id: vulnScannerConnections.id,
        name: vulnScannerConnections.name,
        kind: vulnScannerConnections.kind,
        enabled: vulnScannerConnections.enabled,
        baseUrl: vulnScannerConnections.baseUrl,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
        updatedAt: vulnScannerConnections.updatedAt,
        createdAt: vulnScannerConnections.createdAt,
      })
      .from(vulnScannerConnections)
      .where(eq(vulnScannerConnections.projectId, ctx.project.id))
      .orderBy(desc(vulnScannerConnections.updatedAt), desc(vulnScannerConnections.createdAt));

    return json({ data: rows });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Scanner tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }
}

export async function POST(req: Request) {
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const ctx = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const access = hasNavigatorAccess({ tier: ctx.user.tier });
  if (!access) return json({ error: "Vulnerability scanner integrations are available on Pro." }, { status: 403 });

  const kindRaw = String(body?.kind ?? "").trim().toLowerCase();
  if (!isScannerKind(kindRaw)) return json({ error: "kind must be 'tenable', 'qualys', 'rapid7', or 'openvas'" }, { status: 400 });

  const name = String(body?.name ?? "").trim();
  const enabled = body?.enabled == null ? true : Boolean(body.enabled);
  const baseUrlRaw = String(body?.baseUrl ?? "").trim();
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  if (!name) return json({ error: "name is required" }, { status: 400 });
  if (!baseUrl) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });

  const credCheck = cleanCredentials(kindRaw, body?.credentials ?? {});
  if (!credCheck.ok) return json({ error: credCheck.error }, { status: 400 });

  let credentialsEnc = "";
  try {
    credentialsEnc = await encryptCredentials(credCheck.credentials);
  } catch (err) {
    const msg = safeErrorMessage(err);
    if (/TI_SECRETS_KEY is not set/i.test(msg)) {
      return json({ error: "TI_SECRETS_KEY is not set (required to store scanner credentials safely)." }, { status: 500 });
    }
    return json({ error: "Failed to encrypt scanner credentials" }, { status: 500 });
  }

  try {
    const [row] = await db
      .insert(vulnScannerConnections)
      .values({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        kind: kindRaw,
        name,
        enabled,
        baseUrl,
        credentialsEnc,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: vulnScannerConnections.id,
        name: vulnScannerConnections.name,
        kind: vulnScannerConnections.kind,
        enabled: vulnScannerConnections.enabled,
        baseUrl: vulnScannerConnections.baseUrl,
        lastSyncedAt: vulnScannerConnections.lastSyncedAt,
        updatedAt: vulnScannerConnections.updatedAt,
        createdAt: vulnScannerConnections.createdAt,
      });

    return json({ ok: true, connection: row });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Scanner tables are missing. Run pnpm db:migrate." }, { status: 503 });
    return json({ error: err instanceof Error ? err.message : "Failed to create connection" }, { status: 400 });
  }
}
