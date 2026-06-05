/**
 * VectorSmokeTest — validates pgvector works via Neon HTTP driver.
 *
 * Goal: fail fast if vector operators (cosine distance) aren't supported
 * over @neondatabase/serverless in the runtime you plan to use (Edge/Lambda).
 *
 * Run: pnpm --filter agents run run:vector-smoke
 */

import "../lib/env.js";
import { neon } from "@neondatabase/serverless";

function buildSparseVector(dim: number, hotIndex: number): string {
  const arr = new Array<number>(dim).fill(0);
  if (hotIndex >= 0 && hotIndex < dim) arr[hotIndex] = 1;
  return `[${arr.join(",")}]`;
}

export async function runVectorSmokeTest() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);

  const hasVector =
    await sql`select 1 as ok from pg_extension where extname = 'vector' limit 1`;
  if (hasVector.length === 0) {
    throw new Error(
      "pgvector extension not installed (missing pg_extension row for 'vector'). Run DB migrations first."
    );
  }

  const dim = 1536;
  const q = buildSparseVector(dim, 0);
  const v1 = buildSparseVector(dim, 0);
  const v2 = buildSparseVector(dim, 1);

  const dims = (await sql`select vector_dims(${q}::vector) as dims`) as Array<{
    dims: number;
  }>;
  if (dims[0]?.dims !== dim) {
    throw new Error(
      `Unexpected vector dims: got ${dims[0]?.dims ?? "null"}, expected ${dim}`
    );
  }

  // Note: Neon HTTP queries are stateless, so don't use TEMP tables here.
  // Use a single query with VALUES to validate pgvector operators.
  const rows = (await sql`
    select
      id,
      (v <=> ${q}::vector) as dist
    from (
      values
        (1, ${v1}::vector),
        (2, ${v2}::vector)
    ) as t(id, v)
    order by (v <=> ${q}::vector) asc
  `) as Array<{ id: number; dist: number }>;

  if (rows.length < 2) throw new Error("Smoke test returned no rows");
  if (rows[0]?.id !== 1) {
    throw new Error(
      `Cosine distance ordering unexpected: expected id=1 closest to query, got id=${rows[0]?.id}`
    );
  }

  console.log("[VectorSmokeTest] OK", rows.map((r) => ({ id: r.id, dist: r.dist })));
}

if (process.argv[1]?.endsWith("vector-smoke.ts")) {
  runVectorSmokeTest().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
