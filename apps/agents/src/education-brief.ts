import { mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createEducationBrief, parseEducationEntries } from "./lib/education-brief.js";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      "week-ending": { type: "string" },
      newsletter: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const usage =
    "Usage: pnpm education:brief --input FILE --output NEW_DIRECTORY --week-ending YYYY-MM-DD [--newsletter]";
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.input || !values.output || !values["week-ending"]) throw new Error(usage);

  const caller = process.env.INIT_CWD ?? process.cwd();
  const input = resolve(caller, values.input);
  const output = resolve(caller, values.output);
  const entries = parseEducationEntries(await readFile(input, "utf8"));
  const files = createEducationBrief(entries, values["week-ending"], values.newsletter);
  await mkdir(output);
  const created: string[] = [];
  try {
    for (const [filename, contents] of Object.entries(files)) {
      const path = join(output, filename);
      const file = await open(path, "wx");
      created.push(path);
      try {
        await file.writeFile(contents);
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    await Promise.allSettled(created.map((path) => unlink(path)));
    await rmdir(output).catch(() => undefined);
    throw error;
  }
  console.log(`Created ${Object.keys(files).join(", ")} in ${output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
