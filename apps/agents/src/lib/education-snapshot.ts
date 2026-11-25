import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeEducationSnapshot(
  root: string,
  weekEnding: string,
  queue: string,
  exports: Record<string, string>,
  metrics: object,
) {
  const publicFiles = Object.entries(exports);
  const exportSha256 = createHash("sha256").update(JSON.stringify(publicFiles)).digest("hex");
  const files = {
    "review-queue.jsonl": queue,
    "run.json": JSON.stringify({ weekEnding, exportSha256, ...metrics }, null, 2) + "\n",
    ...Object.fromEntries(publicFiles.map(([name, body]) => [`exports/${name}`, body])),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const output = join(root, `${weekEnding}-${fingerprint}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, ".pending-"));
  try {
    await mkdir(join(staging, "exports"));
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(staging, name), body);
    }
    try {
      await rename(staging, output);
      return { output, created: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      for (const [name, body] of Object.entries(files)) {
        if (await readFile(join(output, name), "utf8") !== body) {
          throw new Error(`Existing snapshot differs at ${name} in ${output}`);
        }
      }
      return { output, created: false };
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
