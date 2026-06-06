import { neon } from "@neondatabase/serverless";
import { KqlError } from "./errors";
import { parseKql } from "./parser";
import { compileKqlToSql, listKqlTables } from "./compiler";

type NeonSql = ReturnType<typeof neon<false, false>>;
let _sql: NeonSql | null = null;

function getSql() {
  if (_sql) return _sql;
  const url = process.env["DATABASE_URL"];
  if (!url) throw new KqlError("DATABASE_URL is not set");
  _sql = neon<false, false>(url, { arrayMode: false, fullResults: false });
  return _sql;
}

export type RunKqlResult = {
  columns: string[];
  rows: any[];
  meta: {
    tables: string[];
    durationMs: number;
    rowCount: number;
  };
  debug?: {
    sql: string;
    params: any[];
  };
};

export async function runKql(
  queryText: string,
  opts?: { defaultLimit?: number; maxLimit?: number; debug?: boolean }
): Promise<RunKqlResult> {
  const started = Date.now();
  const ast = parseKql(queryText);
  const compiled = compileKqlToSql(ast, {
    defaultLimit: opts?.defaultLimit,
    maxLimit: opts?.maxLimit,
  });

  const sql = getSql();
  const rows = (await sql(compiled.sql, compiled.params)) as Record<string, unknown>[];

  const durationMs = Date.now() - started;
  return {
    columns: compiled.columns,
    rows,
    meta: {
      tables: listKqlTables(),
      durationMs,
      rowCount: Array.isArray(rows) ? rows.length : 0,
    },
    debug: opts?.debug ? { sql: compiled.sql, params: compiled.params } : undefined,
  };
}
