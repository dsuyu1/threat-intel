import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");

function rmSafe(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

rmSafe(path.join(webRoot, ".next"));
rmSafe(path.join(webRoot, ".turbo"));
rmSafe(path.join(webRoot, "tsconfig.tsbuildinfo"));

