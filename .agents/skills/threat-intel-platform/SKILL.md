---
name: threat-intel-platform
description: >-
  Repo-specific runbook for the Threat Intel Platform (Next.js web app, AWS
  agents, Postgres/Neon). Use for onboarding, local dev, and “where does this
  live?” questions.
---

# Threat Intel Platform (repo runbook)

Use this skill to quickly orient an agent in this repository and execute common day-to-day workflows safely.

## What this repo contains

- `apps/web`: Next.js app (UI + API routes), deployed on Cloudflare Pages.
- `apps/agents`: Ingestion/enrichment agents (scheduled Lambdas + on-demand runner).
- `apps/mcp`: Python MCP server for external clients (stdio) backed by `/api/v1/*`.
- `packages/db`: Drizzle schema + DB client (`@ti/db`) used by web + agents.

## Local dev (fast path)

1. Copy env: `cp .env.example .env.local` and fill in at least `DATABASE_URL`, `OPENAI_API_KEY` (or `GEMINI_API_KEY`), and `TI_SECRETS_KEY`.
2. Install: `pnpm install`
3. Migrate: `pnpm db:migrate`
4. Run web: `pnpm dev`
5. Seed data (recommended):
   - `pnpm run:ttp`
   - `pnpm run:attack`
   - `pnpm run:vuln`

## Key env vars (high-signal)

- DB: `DATABASE_URL`
- AI: `AI_PROVIDER`, `OPENAI_API_KEY` / `GEMINI_API_KEY`, `AI_MODEL`, `EMBEDDING_MODEL`
- BYOK encryption: `TI_SECRETS_KEY`
- Web: `NEXT_PUBLIC_APP_URL`
- Auth/payments: `CLERK_*`, `STRIPE_*`
- On-demand agents: `AGENTS_ON_DEMAND_URL`, `AGENTS_ON_DEMAND_SECRET`

## Where docs live

- Product docs: `apps/web/src/content/learn/**` (MDX). The web app generates TS from these on `predev`/`prebuild`.
- Ops reference:
  - Agents: `apps/web/src/content/learn/reference/agents.mdx`
  - API: `apps/web/src/content/learn/reference/api.mdx`
  - KQL: `apps/web/src/content/learn/reference/kql/**`

## Common gotchas

- Windows `.next` ENOENT flakiness: stop all dev servers and run `pnpm dev:clean` (see root `README.md`).
- DB migrations: always confirm you’re pointing at the intended `DATABASE_URL` before generating/applying migrations.

