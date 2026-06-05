import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../");

dotenv.config({ path: resolve(repoRoot, ".env"), override: false });
dotenv.config({ path: resolve(repoRoot, "apps/web/.env.local"), override: false });

