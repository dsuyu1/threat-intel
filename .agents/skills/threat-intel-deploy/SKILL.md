---
name: threat-intel-deploy
description: >-
  Deployment runbook: Cloudflare Pages for apps/web and Serverless Framework
  (AWS Lambda + EventBridge) for apps/agents, including on-demand enqueue wiring.
---

# Deploying Threat Intel

Use this skill when preparing or debugging deployments.

## Web (Cloudflare Pages)

- App: `apps/web`
- Build (Pages-compatible): `pnpm --filter web pages:build` (uses `next-on-pages`)
- Config: `apps/web/wrangler.toml`

Ensure production env vars include everything in `.env.example`, especially:
- `DATABASE_URL`, `TI_SECRETS_KEY`
- `CLERK_*`, `STRIPE_*`
- `AGENTS_ON_DEMAND_URL`, `AGENTS_ON_DEMAND_SECRET`

## Agents (AWS Lambda via Serverless Framework)

- App: `apps/agents`
- Config: `apps/agents/serverless.yml`
- Deploy:
  - `pnpm --filter agents deploy --stage prod`
  - `pnpm --filter agents deploy:dev --stage dev` (or use the `deploy:dev` script)

Secrets are expected in SSM Parameter Store under `/threat-intel/*` (see `serverless.yml`).

## On-demand runs (web → agents)

- Web calls `AGENTS_ON_DEMAND_URL` with `Authorization: Bearer ${AGENTS_ON_DEMAND_SECRET}`.
- Agents expose `POST /on-demand` via the `onDemandEnqueue` function (HTTP API).
- The enqueue handler asynchronously invokes `onDemandAgentRunner`.

## DB migrations in deploys

Run `pnpm db:migrate` against the target database before deploying code that relies on new tables/columns.

