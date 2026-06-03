# Threat Intelligence Platform

AI-powered threat intel feed — CVEs, cyberattacks, TTPs, exploits, malware.
Hosted at [security.damianvillarreal.com](https://security.damianvillarreal.com).

**Private repository — UTRGV Cybersecurity Club members only.**

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

# 6. Test VulnAgent
pnpm run:vuln
```

## Project Structure

```
threat-intel-platform/
├── apps/
│   ├── web/          # Next.js app (UI + API routes)
│   └── agents/       # Agent scripts (run on cron)
├── packages/
│   ├── db/           # Drizzle schema + client
│   └── ai/           # Shared AI helpers
├── .env.example
└── turbo.json
```

## Agents

| Agent | Schedule | Sources |
|---|---|---|
| VulnAgent | Every 6h | NVD, CISA KEV |
| AttackAgent | Every 4h | Threat blogs, CISA Alerts |
| TTPAgent | Daily 06:00 UTC | MITRE ATT&CK STIX |
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
