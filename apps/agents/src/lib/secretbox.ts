const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function getAesKey(): Promise<CryptoKey> {
  const raw = String(process.env["TI_SECRETS_KEY"] ?? "").trim();
  if (!raw) throw new Error("TI_SECRETS_KEY is not set");

  // Support key rotation: first key encrypts, all keys may decrypt.
  const [secret] = raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!secret) throw new Error("TI_SECRETS_KEY is not set");

  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function getAesKeys(): Promise<CryptoKey[]> {
  const raw = String(process.env["TI_SECRETS_KEY"] ?? "").trim();
  if (!raw) throw new Error("TI_SECRETS_KEY is not set");

  const secrets = raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!secrets.length) throw new Error("TI_SECRETS_KEY is not set");

  const hashes = await Promise.all(secrets.map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return Promise.all(hashes.map((hash) => crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])));
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(cipher)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const s = String(payload ?? "");
  const [v, ivB64, ctB64] = s.split(":");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Invalid secret payload");
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);

  let lastErr: unknown;
  const keys = await getAesKeys();
  for (const key of keys) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return decoder.decode(plain);
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error("Unable to decrypt secret payload", { cause: lastErr as any });
}
