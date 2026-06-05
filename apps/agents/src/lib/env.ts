import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../");

dotenv.config({ path: resolve(repoRoot, ".env"), override: false });
dotenv.config({ path: resolve(repoRoot, ".env.local"), override: false });
dotenv.config({ path: resolve(repoRoot, "apps/web/.env.local"), override: false });

// Prefer repo-local OpenAI config over global machine env vars.
// This avoids cases where a stale/incorrect OPENAI_API_KEY is set globally,
// but the correct project key lives in `.env.local`.
try {
  const localEnvPath = resolve(repoRoot, ".env.local");
  if (fs.existsSync(localEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(localEnvPath));
    for (const k of [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "AI_PROVIDER",
      "AI_MODEL",
      "EMBEDDING_MODEL",
    ] as const) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim() !== "") process.env[k] = v;
    }
  }
} catch {
  // Best-effort: never fail startup because of env parsing.
}
