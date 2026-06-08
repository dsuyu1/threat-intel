import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Load env files from most-specific to least-specific so local migrations run against the same
// database the app uses, while still respecting externally provided env vars (override: false).
dotenv.config({ path: resolve(here, "../../apps/web/.env.local"), override: false });
dotenv.config({ path: resolve(here, "../../.env.local"), override: false });
dotenv.config({ path: resolve(here, "../../.env"), override: false });

function fnv1a32Hex(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeDatabaseUrl(databaseUrl: string) {
  try {
    const u = new URL(databaseUrl);
    const db = u.pathname.replace(/^\/+/, "");
    return { host: u.host, database: db || undefined };
  } catch {
    return {};
  }
}

const configuredDatabaseUrl = process.env["DATABASE_URL"] ?? "";
if (configuredDatabaseUrl) {
  const summary = summarizeDatabaseUrl(configuredDatabaseUrl);
  // Print a safe DB fingerprint so it's easy to confirm migrations are running against the same
  // DATABASE_URL the app is using (without leaking credentials).
  console.log(
    `[db] drizzle-kit DATABASE_URL fingerprint=${fnv1a32Hex(configuredDatabaseUrl)} host=${summary.host ?? "?"} db=${summary.database ?? "?"}`,
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: configuredDatabaseUrl,
  },
});
