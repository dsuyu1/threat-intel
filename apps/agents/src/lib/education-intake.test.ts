import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEducationBrief, parseEducationLedger } from "./education-brief.js";
import { lastCompletedSunday, parseEducationWatchlist, prepareEducationQueue } from "./education-intake.js";
import { writeEducationSnapshot } from "./education-snapshot.js";

const date = "2026-11-21";
const roster = {
  date,
  url: "https://example.org/roster?record=57&utm_medium=rss#summary",
  title: "ExampleRoster 2.0 vendor advisory for CVE-2099-54321",
  iocCandidates: ["TRAINING.EXAMPLE", "training.example"],
  actorCandidates: ["Example actor"],
};
const watchlist = parseEducationWatchlist(JSON.stringify([{ product: "ExampleRoster 2.0", audiences: ["k-12"] }]));
const feed = (...rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n");

describe("automated education intake", () => {
  it("queues watchlist matches, ignores irrelevant news, and keeps processing after malformed rows", () => {
    const raw = feed(
      roster,
      { ...roster, url: "https://example.org/roster?record=57" },
      { ...roster, url: "https://example.org/library", title: "University library extends opening hours" },
    ) + "\n{partial";
    const queue = prepareEducationQueue(raw, watchlist, new Set(), []);
    const draft = JSON.parse(queue.jsonl);

    expect(queue.counts).toEqual({ read: 4, duplicates: 1, queued: 1, unmatched: 1, alreadyHandled: 0, invalidLines: [4] });
    expect(draft).toMatchObject({
      status: "draft",
      sharing: "restricted",
      audiences: ["k-12"],
      sources: ["https://example.org/roster?record=57"],
      intake: { cves: ["CVE-2099-54321"], iocCandidates: [{ kind: "domain", value: "training.example" }] },
    });
    const { entries } = parseEducationLedger(queue.jsonl);
    const outputs = createEducationBrief(entries, date, true);
    expect(Object.values(outputs).join("\n")).not.toMatch(/ExampleRoster|training\.example|Example actor/);
  });

  it("uses stable source IDs and suppresses dismissed rows and coverage attached to reviewed records", () => {
    const alias = { ...roster, url: "https://example.org/roster?record=57&gclid=test" };
    const first = prepareEducationQueue(feed(roster), watchlist, new Set(), []);
    const second = prepareEducationQueue(feed(alias), watchlist, new Set(), []);
    expect(second.jsonl).toBe(first.jsonl);
    const { id } = JSON.parse(first.jsonl);
    const review = parseEducationLedger(JSON.stringify({ id, status: "dismissed", sharing: "restricted" }));
    expect(prepareEducationQueue(feed(alias), watchlist, review.handledIds, []).counts.alreadyHandled).toBe(1);
    expect(prepareEducationQueue(feed(alias), watchlist, new Set(), [roster.url]).counts.alreadyHandled).toBe(1);
  });

  it("defaults to the last fully elapsed Sunday in UTC", () => {
    expect(lastCompletedSunday(new Date("2026-11-22T11:00:00Z"))).toBe("2026-11-15");
    expect(lastCompletedSunday(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-22");
  });

  it("commits one complete snapshot under concurrent retries and keeps private intake outside exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "education-intake-test-"));
    try {
      const run = () => writeEducationSnapshot(root, date, "queue\n", { "report.md": "report\n" }, { count: 1 });
      const snapshots = await Promise.all([run(), run()]);
      const [first, second] = snapshots;
      expect(first.output).toBe(second.output);
      expect(snapshots.filter(({ created }) => created)).toHaveLength(1);
      expect(await readdir(join(first.output, "exports"))).toEqual(["report.md"]);
      expect(await readFile(join(first.output, "review-queue.jsonl"), "utf8")).toBe("queue\n");
      const revised = await writeEducationSnapshot(root, date, "edited queue\n", { "report.md": "report\n" }, { count: 2 });
      expect(revised.output).not.toBe(first.output);
      const manifest = async (output: string) => JSON.parse(await readFile(join(output, "run.json"), "utf8"));
      expect((await manifest(revised.output)).exportSha256).toBe((await manifest(first.output)).exportSha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
