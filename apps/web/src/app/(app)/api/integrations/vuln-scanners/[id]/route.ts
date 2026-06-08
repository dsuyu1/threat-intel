export const runtime = "edge";

import { getDb, vulnScannerConnections } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { decryptSecret, encryptSecret } from "../../../../../../lib/secretbox";
import { getViewerContext } from "../../../../../../lib/tenancy";

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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });
  const body = (await req.json().catch(() => null)) as any;

  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Vulnerability scanner integrations are available on Pro." }, { status: 403 });

  const patch: Record<string, any> = { updatedAt: new Date() };

  if (body?.name != null) patch.name = String(body.name).trim();
  if (body?.enabled != null) patch.enabled = Boolean(body.enabled);

  if (body?.baseUrl != null) {
    const href = normalizeBaseUrl(String(body.baseUrl).trim());
    if (!href) return json({ error: "baseUrl must be a valid http(s) URL" }, { status: 400 });
    patch.baseUrl = href;
  }

  if (body?.kind != null) {
    const k = String(body.kind ?? "").trim().toLowerCase();
    if (!isScannerKind(k)) return json({ error: "kind must be 'tenable', 'qualys', 'rapid7', or 'openvas'" }, { status: 400 });
    patch.kind = k;
  }

  if (body?.credentials != null) {
    const kind = (patch.kind as ScannerKind | undefined) ?? null;
    let effectiveKind: ScannerKind | null = kind;
    if (!effectiveKind) {
      const [row] = await db
        .select({ kind: vulnScannerConnections.kind })
        .from(vulnScannerConnections)
        .where(and(eq(vulnScannerConnections.id, id), eq(vulnScannerConnections.projectId, viewer.project.id)))
        .limit(1);
      effectiveKind = (row?.kind as any) ?? null;
    }
    if (!effectiveKind) return json({ error: "Unknown connection kind" }, { status: 404 });

    const credCheck = cleanCredentials(effectiveKind, body.credentials);
    if (!credCheck.ok) return json({ error: credCheck.error }, { status: 400 });

    try {
      patch.credentialsEnc = await encryptCredentials(credCheck.credentials);
    } catch (err) {
      const msg = safeErrorMessage(err);
      if (/TI_SECRETS_KEY is not set/i.test(msg)) {
        return json({ error: "TI_SECRETS_KEY is not set (required to store scanner credentials safely)." }, { status: 500 });
      }
      return json({ error: "Failed to encrypt scanner credentials" }, { status: 500 });
    }
  }

  if (patch.name === "") return json({ error: "name is required" }, { status: 400 });

  let row:
    | {
        id: string;
        name: string;
        kind: string;
        enabled: boolean;
        baseUrl: string;
        lastSyncedAt: Date | null;
        updatedAt: Date;
        createdAt: Date;
      }
    | undefined;

  try {
    [row] = await db
      .update(vulnScannerConnections)
      .set(patch)
      .where(
        and(
          eq(vulnScannerConnections.id, id),
          eq(vulnScannerConnections.projectId, viewer.project.id),
          eq(vulnScannerConnections.userId, viewer.user.id)
        )
      )
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
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Scanner tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, connection: row });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const projectSlug = req.headers.get("x-ti-project-slug");
  const viewer = await getViewerContext({ projectSlug });

  const access = hasNavigatorAccess({ tier: viewer.user.tier });
  if (!access) return json({ error: "Vulnerability scanner integrations are available on Pro." }, { status: 403 });

  let row: { id: string } | undefined;
  try {
    [row] = await db
      .delete(vulnScannerConnections)
      .where(
        and(
          eq(vulnScannerConnections.id, id),
          eq(vulnScannerConnections.projectId, viewer.project.id),
          eq(vulnScannerConnections.userId, viewer.user.id)
        )
      )
      .returning({ id: vulnScannerConnections.id });
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") return json({ error: "Scanner tables are missing. Run pnpm db:migrate." }, { status: 503 });
    throw err;
  }

  if (!row) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true });
}
