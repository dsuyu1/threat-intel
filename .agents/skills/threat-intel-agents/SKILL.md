---
name: threat-intel-agents
description: >-
  How agents work in this repo (apps/agents): local runs, AWS schedules,
  on-demand runs from the web app, and how to add a new agent safely.
---

# Threat Intel Agents (apps/agents)

Use this skill when adding/fixing ingestion or enrichment agents, or debugging why “the UI is empty”.

## Where things live

- Agent implementations: `apps/agents/src/agents/*.ts`
- Scheduled Lambda handlers: `apps/agents/src/handlers/*.ts`
- Schedules + env wiring: `apps/agents/serverless.yml`
- Convenience runner (local): `apps/agents/src/run-all.ts`

## Run agents locally

From repo root:

- `pnpm run:vuln`
- `pnpm run:attack`
- `pnpm run:ttp`
- `pnpm agents:run` (runs many agents sequentially)

All agents expect `DATABASE_URL` and may require provider keys (see `.env.example`).

## How on-demand runs work (UI “Run now”)

The web app endpoint `apps/web/src/app/(app)/api/agents/run/route.ts` enqueues a run by POSTing to:

- `AGENTS_ON_DEMAND_URL` (HTTP endpoint)
- with `Authorization: Bearer ${AGENTS_ON_DEMAND_SECRET}`

In AWS deploys, `apps/agents/serverless.yml` provides an HTTP API endpoint:
- `onDemandEnqueue` at `POST /on-demand`

Set `AGENTS_ON_DEMAND_URL` in the web deployment to that URL, and set the same `AGENTS_ON_DEMAND_SECRET` for web + agents.

## Add a new agent (checklist)

1. Implement the agent in `apps/agents/src/agents/<name>.ts`.
2. Add a scheduled handler in `apps/agents/src/handlers/<name>.ts` (if it should run on a cadence).
3. Register the Lambda + schedule in `apps/agents/serverless.yml`.
4. Optionally wire into `apps/agents/src/run-all.ts` for local parity.
5. If the UI exposes it, add it to `apps/web/src/lib/agents` and update any docs under `apps/web/src/content/learn/reference/agents.mdx`.

