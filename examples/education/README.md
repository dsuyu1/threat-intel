# Education threat intelligence pilot

Run this job against the news your server already polls. It creates a private review queue and generates all publication files from the same approved ledger. The sample files contain fictional records.

```bash
pnpm education:brief --input examples/education/reviewed.jsonl \
  --feed examples/education/news.jsonl --watchlist examples/education/watchlist.json \
  --output /tmp/education-snapshots --week-ending 2026-11-22 --newsletter
```

Each run logs the snapshot directory and intake counts. Identical reruns reuse the same snapshot. Changes create a new snapshot for that week. The job writes a complete snapshot before making it available. There are three parts:

- `review-queue.jsonl` contains pending stories, suggested audiences and actions, and candidate CVEs, actor names, and IoCs when supplied or recognized. The queue is private and is outside the export directory.
- `run.json` records read, unmatched, duplicate, already handled, and queued counts, plus the line numbers of malformed input. `exportSha256` identifies the export contents independently of changes to the review queue.
- `exports/` contains the files below, which are generated from the reviewed ledger. Newsletter output is enabled with `--newsletter`.

| File | Contents |
| --- | --- |
| `report.md` | Seven days of reviewed entries ending on the selected UTC date, with action owners, sources, actor attribution, and targeting counts compared with the preceding seven days |
| `iocs.csv` | Normalized, cited indicators from approved public entries dated through the report end, with evidence rows retained per entry and source until the indicator's review date passes |
| `blog-draft.md` | Three highest-priority items with audience, context, action, and citations |
| `newsletter-draft.md` | Optional short digest of the same highlights, generated with `--newsletter` |

## Connect your poller

- Export a rolling JSON Lines file with the UTC publication `date` (`YYYY-MM-DD`), `url`, and `title`. Optional fields are `excerpt`, `actorCandidates` (an array of names from the source), and `iocCandidates` (an array of explicitly identified domains, IPs, URLs, or hashes). The script recognizes CVE IDs in titles and excerpts and normalizes supplied indicator values. The queue records candidates as leads for review.
- Include open items in the rolling export until they receive a disposition. Write the feed to a temporary file and rename it over the previous version when complete. At intake, the first eligible copy of each canonical URL wins. Feed updates that need to replace earlier source text should replace those rows in the upstream export. The job strips common tracking parameters and URL fragments while retaining other query parameters.
- Configure an optional JSON array of product names with their audiences, following `watchlist.json`. Security terms combined with an education signal or product match create a candidate. Broad education mentions may require the reviewer to assign an audience. Review unmatched counts as you tune terms and source coverage.
- Start with an empty reviewed ledger, or use the included fictional one for a dry run. Move a candidate into the ledger under the same ID when a reviewer takes ownership. Add a record with that ID, `status: dismissed` and `sharing: restricted` to keep irrelevant items out of the queue on later runs. When consolidating approved public coverage, include each source URL on the approved record so the same articles stay out of the queue.

Run the command after the poller's normal refresh, or schedule it on the server. When `--week-ending` is omitted in feed mode, the generator uses the most recently completed Sunday in UTC. Pass an explicit date for a backfill. A cron entry for an installation under `/opt/threat-intel` with `pnpm` on the job's PATH can look like this:

```cron
*/30 * * * * cd /opt/threat-intel && pnpm education:brief --input /var/lib/education-intel/reviewed.jsonl --feed /var/lib/education-intel/news.jsonl --watchlist /var/lib/education-intel/watchlist.json --output /var/lib/education-intel/snapshots --newsletter
```

Feed and reviewed ledger paths should live outside the checkout and webroot. A publishing integration should consume only `exports/` and track the export hash for each reporting period. Malformed feed rows are counted and skipped. Missing files, invalid watchlists, and invalid review records fail the run before it exposes a snapshot.

To render directly from the ledger, omit `--feed` and pass a new output directory and an explicit `--week-ending`. The command requires the workspace dependencies and runs without database credentials or API keys.

## Review ledger

The input is JSON Lines, with one JSON object per line. The generator reads records marked both `status: approved` and `sharing: public`. Approval covers the complete record, including any indicator or actor attribution included with it. Use external public sources you can cite and verify that the evidence can be redistributed before approving. Keep internal URLs, logs, victim personal data, and restricted sharing content in existing private systems. Review the generated drafts before publishing.

| Field | Review rule |
| --- | --- |
| `id`, `date`, `title`, `summary` | Use a stable ID, the source publication date (`YYYY-MM-DD`), and an original summary. Put follow-up links on the same record when they cover the same event. |
| `audiences` | Include one or both of `higher-ed` and `k-12`. |
| `coverage` | Use `reported-targeting` when a source reports an education incident or campaign. Use `technology-exposure` for an advisory on relevant technology and `education-advisory` for sector guidance. |
| `topic` | Choose `identity`, `ransomware`, `third-party`, `exploited-vulnerability`, `disruption`, or `other`. |
| `priority`, `owner`, `action` | Choose `act-now` for an urgent defensive step, `check-exposure` for an inventory or telemetry check, or `monitor` for awareness. Name the role responsible and phrase the action as a verb. |
| `sources` | Include one or more public HTTP(S) primary or corroborating source links. |
| `attribution` | Optional. Supply `actor`, `confidence` (`low`, `medium`, or `high`), and `sourceUrl` present in `sources`. Keep a consistent actor name and omit attribution when evidence is insufficient. |
| `indicators` | Optional. Supply `kind`, `value`, `confidence` (`medium` or `high`), `validThrough`, and `sourceUrl` present in `sources`. Review for shared infrastructure, redacted or placeholder values, and sensitive URL parameters. |

Counts describe reviewed public reporting. Compare source coverage before interpreting week-to-week movement. Inspect the evidence for indicator matches in the SIEM or EDR before taking action.

## Next automation steps

1. **Reduce review time.** Reuse the existing ingestion and actor data to suggest related coverage and prefill a source-cited summary. Keep the editor's approval on targeting claims, attribution, and IoC redistribution.
2. **Enrich matching advisories.** Look up CVE candidates in CISA KEV and fetch affected versions from primary vendor advisories. Use the existing watchlist and project context to route follow-up to the relevant team.
3. **Wire publishing destinations.** Publish an approved release automatically to the education archive, with per-period and per-destination delivery records. Use the same release for the opt-in newsletter. Retry transient failures and use provider idempotency where available.
4. **Measure the pilot.** Start with one campus and one district. Track review time, useful alerts, corrections, and indicators that lead to triage.

Starting sources include the [REN-ISAC public alerts](https://www.ren-isac.net/services/publications/alerts/index.html), the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), and public advisories from vendors on your product watchlists. CISA's [K–12 report](https://www.cisa.gov/sites/default/files/2023-01/K-12report_FINAL_V2_508c.pdf) provides context for the pilot's district priorities.
