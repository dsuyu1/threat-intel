# Threat Intelligence Platform

AI-powered threat intel feed — CVEs, cyberattacks, TTPs, exploits, malware.
Hosted at [security.damianvillarreal.com](https://security.damianvillarreal.com).

## Education pilot

Generate a weekly higher-ed and K–12 threat brief, indicator CSV, blog draft, and optional newsletter draft from reviewed evidence. See the [education pilot](examples/education/README.md) for the sample run and news poller handoff.

## Stack

- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Database:** PostgreSQL via [Neon](https://neon.tech) + Drizzle ORM
- **AI:** OpenAI GPT-4o-mini (or AWS Bedrock Claude Haiku)
- **Auth:** Clerk
- **Payments:** Stripe ($5/mo)
- **Hosting:** Cloudflare Pages (frontend) + cron triggers (agents)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/YOUR_ORG/threat-intel-platform
cd threat-intel-platform

# 2. Install (requires pnpm)
npm i -g pnpm
pnpm install

# 3. Environment
cp .env.example .env.local
# Fill in DATABASE_URL, OPENAI_API_KEY, NVD_API_KEY, CLERK_*, STRIPE_*

# 4. Create DB tables
pnpm db:migrate

# 5. Run locally
pnpm dev

# 6. Seed minimum actor data (recommended)
pnpm run:ttp      # MITRE ATT&CK STIX (no AI)
pnpm run:attack   # RSS ingestion + AI extraction (backfills ~30 days)

# 7. Test VulnAgent
pnpm run:vuln
```

## Windows dev server ENOENT issues

If you see intermittent Next.js dev errors like missing files under `apps/web/.next/**` (e.g. `_buildManifest.js.tmp.*` or `app-build-manifest.json`), it’s almost always one of:

- Two `next dev` processes running at the same time (both writing to the same `.next` directory)
- Something deleting/locking `.next` while dev is running (manual deletes, antivirus/EDR, OneDrive/Dropbox sync)

Fix:

1. Stop all dev servers.
2. Run `pnpm dev:clean` (or `pnpm --filter web dev:clean`).
3. If it keeps happening, exclude `apps/web/.next` from Defender/EDR and ensure the repo isn’t in a synced folder.

## Project Structure

```
threat-intel-platform/
├── apps/
│   ├── web/          # Next.js app (UI + API routes)
│   ├── agents/       # Agent scripts (run on cron)
│   └── mcp/          # MCP server (FastMCP) for external clients
├── packages/
│   ├── db/           # Drizzle schema + client
│   └── ai/           # Shared AI helpers
├── .env.example
└── turbo.json
```

## MCP Server

The repo includes an MCP server at `apps/mcp` that connects to the platform via API-key authenticated `/api/v1/*` endpoints.

- Local install/run details: `apps/mcp/README.md`
- Required API key scopes include: `findings:read`, `actors:read`, `cves:read`, `query:run`, `navigator:read`, `playbooks:write`, `detections:generate`

## Agents

| Agent | Schedule | Sources |
|---|---|---|
| VulnAgent | Every 6h | NVD, CISA KEV |
| AttackAgent | Every 4h | Threat blogs, CISA Alerts |
| TTPAgent | Weekly Sun 06:00 UTC | MITRE ATT&CK STIX |
| ExploitAgent | Every 2h | GitHub, ExploitDB |
| MalwareAgent | Every 12h | MalwareBazaar, Any.run |

## Deployment (Cloudflare Pages)

1. Connect repo to Cloudflare Pages
2. Set build command: `pnpm build`
3. Set output directory: `apps/web/.next`
4. Add all env vars in Pages dashboard
5. Add Cron Triggers in `wrangler.toml` to call `/api/cron/vuln` etc.

## Contributing (Club Members)

See `research/TRACKS.md` for research track instructions.
Pick a track, create a branch `research/your-name/topic`, submit a PR.
