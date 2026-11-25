import { mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createEducationBrief, parseEducationLedger } from "./lib/education-brief.js";
import { lastCompletedSunday, parseEducationWatchlist, prepareEducationQueue } from "./lib/education-intake.js";
import { writeEducationSnapshot } from "./lib/education-snapshot.js";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      feed: { type: "string" },
      watchlist: { type: "string" },
      output: { type: "string" },
      "week-ending": { type: "string" },
      newsletter: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const usage = [
    "pnpm education:brief --input REVIEWED --output NEW_DIRECTORY --week-ending YYYY-MM-DD [--newsletter]",
    "pnpm education:brief --input REVIEWED --feed NEWS --output SNAPSHOTS [--watchlist FILE] [--week-ending YYYY-MM-DD] [--newsletter]",
  ].join("\n");
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.input || !values.output || (values.feed === undefined && !values["week-ending"]) ||
      (values.watchlist !== undefined && values.feed === undefined)) {
    throw new Error(usage);
  }

  const caller = process.env.INIT_CWD ?? process.cwd();
  const input = resolve(caller, values.input);
  const output = resolve(caller, values.output);
  const { entries, handledIds } = parseEducationLedger(await readFile(input, "utf8"));
  const weekEnding = values["week-ending"] ?? lastCompletedSunday();
  const files = createEducationBrief(entries, weekEnding, values.newsletter);
  if (values.feed !== undefined) {
    const [feed, watchlist] = await Promise.all([
      readFile(resolve(caller, values.feed), "utf8"),
      values.watchlist === undefined
        ? Promise.resolve([])
        : readFile(resolve(caller, values.watchlist), "utf8").then(parseEducationWatchlist),
    ]);
    const queue = prepareEducationQueue(feed, watchlist, handledIds, entries.flatMap(({ sources }) => sources));
    const metrics = { approvedPublicEntries: entries.length, intake: queue.counts };
    const snapshot = await writeEducationSnapshot(output, weekEnding, queue.jsonl, files, metrics);
    console.log(JSON.stringify({ ...snapshot, ...metrics }));
    return;
  }
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
