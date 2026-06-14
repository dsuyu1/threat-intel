---
name: threat-intel-web
description: >-
  How to work in apps/web (Next.js 15 App Router): route layout, API handlers,
  Edge runtime constraints, auth/tenancy, and learn-doc generation.
---

# Threat Intel Web (apps/web)

Use this skill when implementing UI/API changes in `apps/web`.

## Structure

- App Router lives under `apps/web/src/app`.
  - Authenticated app routes are grouped under `apps/web/src/app/(app)/**`.
  - Public routes are grouped under `apps/web/src/app/(public)/**`.
- API routes are `route.ts` files under `apps/web/src/app/**/api/**`.
  - Versioned API-key endpoints live under `apps/web/src/app/(app)/api/v1/**`.

## Edge runtime constraints

Some handlers set `export const runtime = "edge"`.

When in Edge:
- Prefer `fetch` and Web APIs over Node-only APIs.
- Use DB via `@ti/db` (Neon HTTP + Drizzle), not socket-based Postgres clients.

## DB + tenancy patterns

- Use `getDb()` from `@ti/db` (singleton).
- For app-scoped queries, prefer going through viewer/project helpers (example: `getViewerContext()` in `apps/web/src/lib/tenancy`).

## Learn docs (MDX)

- Source docs: `apps/web/src/content/learn/**/*.mdx`
- Generator: `apps/web/scripts/generate-learn.mjs`
- Runs automatically on `pnpm --filter web dev`/`build` via `predev`/`prebuild`.

If you change MDX and TS types feel stale, run: `pnpm --filter web generate:learn`.

## Branding

- Brand mark assets: `apps/web/public/brand/lotus.svg` (legacy: `waddlings.svg`, `waddlings.png`)
- Header brand component: `apps/web/src/components/SiteLogo.tsx` (currently not rendered in layouts)
