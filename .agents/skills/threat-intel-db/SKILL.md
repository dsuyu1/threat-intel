---
name: threat-intel-db
description: >-
  Drizzle + Neon workflow for this repo: schema edits, migration generation,
  running migrations, and safe DB usage from Edge + Node runtimes.
---

# Threat Intel DB (packages/db)

Use this skill for schema changes, migrations, and DB access patterns.

## The DB package

- Package: `packages/db` (exported as `@ti/db`)
- Client: Neon HTTP (`@neondatabase/serverless`) + `drizzle-orm/neon-http`
- Schema source of truth: `packages/db/src/schema.ts`

## Migrations

From repo root:

- Generate a migration: `pnpm db:generate`
- Apply migrations: `pnpm db:migrate`

Notes:
- `packages/db/drizzle.config.ts` loads env from `apps/web/.env.local`, root `.env.local`, then `.env`.
- It prints a safe `DATABASE_URL` fingerprint on migration runs — use it to avoid migrating the wrong DB.

## Query patterns

- Prefer `getDb()` from `@ti/db` (singleton) over creating new clients.
- Use Drizzle query builders; keep raw SQL rare and well-justified.
- Edge-safe DB access: do not introduce socket-based Postgres clients into `apps/web` handlers.

