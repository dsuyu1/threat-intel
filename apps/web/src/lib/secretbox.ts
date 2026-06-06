import "server-only";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  // Edge runtimes: prefer btoa/atob. Node: Buffer exists.
  const anyGlobal = globalThis as any;
  if (anyGlobal.Buffer) return anyGlobal.Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const anyGlobal = globalThis as any;
  if (anyGlobal.Buffer) {
    const buf = anyGlobal.Buffer.from(b64, "base64") as Uint8Array;
    // Copy into a fresh ArrayBuffer so WebCrypto typings accept it in all runtimes.
    return Uint8Array.from(buf);
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function getAesKey(): Promise<CryptoKey> {
  const secret = String(process.env["TI_SECRETS_KEY"] ?? "").trim();
  if (!secret) {
    throw new Error("TI_SECRETS_KEY is not set (required to store user API keys safely).");
  }
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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
  const key = await getAesKey();
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return decoder.decode(plain);
}
