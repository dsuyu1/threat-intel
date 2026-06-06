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

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
