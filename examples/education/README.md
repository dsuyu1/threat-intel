# Education threat intelligence pilot

Use the existing news poller as the intake queue. Reviewers turn relevant stories into one record per distinct incident, campaign, or advisory and reuse the same ID when new coverage appears. Keep the ledger outside the repo when it contains real operational details. The included ledger is fictional.

```bash
pnpm education:brief --input examples/education/reviewed.jsonl --output /tmp/education-brief-example --week-ending 2026-11-18 --newsletter
```

Use a new output directory. Rerun with a different directory to compare revisions. The command needs the workspace dependencies and runs without database credentials or API keys.

| File | Contents |
| --- | --- |
| `report.md` | Seven days of reviewed entries ending on the selected UTC date, with action owners, sources, actor attribution, and targeting counts compared with the preceding seven days |
| `iocs.csv` | Normalized, cited indicators from approved public entries dated through the report end, with evidence rows retained per entry and source until the indicator's review date passes |
| `blog-draft.md` | Three highest-priority items with audience, context, action, and citations |
| `newsletter-draft.md` | Optional short digest of the same highlights, generated with `--newsletter` |

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

## What to build next

1. **Feed the review queue.** Map your poller's URL, source, published date, and title into draft records. Upsert by canonical URL at intake. Group multiple sources on one reviewed record after a human confirms they describe the same event.
2. **Add product watchlists.** Use separate higher-ed and K–12 profiles in the existing watchlist workflow. Start with identity, remote access, student information and learning systems, plus research infrastructure for campuses. Match public vendor notices and CISA KEV entries to products that the institution uses.
3. **Add a review page.** Reuse the site's source and actor data for candidate links. Record approval and corrections with timestamps and author identity. Start with one campus and one district reviewer, and measure time to review, usefulness of recommended actions, and indicator matches that lead to triage.
4. **Publish from the same record set.** Archive approved reports and drafts on a dedicated education landing page. Add email delivery after you have an audience and a publishing cadence. Leave the existing generic agents and paid features out of the education pilot's scheduled jobs.

Starting sources include the [REN-ISAC public alerts](https://www.ren-isac.net/services/publications/alerts/index.html), the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), and public advisories from vendors on your product watchlists. CISA's [K–12 report](https://www.cisa.gov/sites/default/files/2023-01/K-12report_FINAL_V2_508c.pdf) provides context for the pilot's district priorities.
