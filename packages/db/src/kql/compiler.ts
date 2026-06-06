import type { KqlAgg, KqlExpr, KqlJoinFieldRef, KqlQuery, KqlStage, KqlValueExpr } from "./ast";
import { KqlError } from "./errors";

export type CompiledKql = {
  sql: string;
  params: any[];
  columns: string[];
};

type Plan = {
  sql: string;
  params: any[];
  columns: string[];
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function qIdent(name: string) {
  if (!IDENT_RE.test(name)) throw new KqlError(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

function shiftPlaceholders(sql: string, offset: number) {
  if (offset <= 0) return sql;
  return sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

class SqlParams {
  params: any[];
  constructor(initial: any[] = []) {
    this.params = [...initial];
  }
  add(value: any) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

type TableDef = {
  name: string;
  sql: string;
  columns: string[];
};

const TABLES: Record<string, TableDef> = {
  Entities: {
    name: "Entities",
    columns: ["kind", "entityId", "name", "aliases", "description", "attributes", "createdAt", "updatedAt"],
    sql: `
      SELECT
        kind AS "kind",
        entity_id AS "entityId",
        name AS "name",
        aliases AS "aliases",
        description AS "description",
        attributes AS "attributes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM kg_entities
    `.trim(),
  },
  Actors: {
    name: "Actors",
    columns: [
      "actorId",
      "name",
      "aliases",
      "description",
      "attributes",
      "createdAt",
      "updatedAt",
      "originIso2",
      "lastSeen",
      "ttpCount",
      "mitigationCount",
      "cveCount",
      "sectorCount",
    ],
    sql: `
      WITH actors AS (
        SELECT
          entity_id AS "actorId",
          name AS "name",
          aliases AS "aliases",
          description AS "description",
          attributes AS "attributes",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM kg_entities
        WHERE kind = 'actor'
      ),
      rel_stats AS (
        SELECT
          from_id AS "actorId",
          max(last_seen) AS "lastSeen",
          count(distinct case when type = 'actor_uses_technique' and to_kind = 'technique' then to_id end) AS "ttpCount",
          count(distinct case when type = 'actor_targets_sector' and to_kind = 'sector' then to_id end) AS "sectorCount",
          count(distinct case when type = 'actor_exploits_cve' and to_kind = 'cve' then to_id end) AS "cveCount"
        FROM kg_relations
        WHERE from_kind = 'actor'
        GROUP BY from_id
      ),
      mitigation_counts AS (
        SELECT
          a2t.from_id AS "actorId",
          count(distinct t2m.to_id) AS "mitigationCount"
        FROM kg_relations a2t
        INNER JOIN kg_relations t2m
          ON t2m.type = 'technique_mitigated_by'
          AND t2m.from_kind = 'technique'
          AND t2m.to_kind = 'mitigation'
          AND t2m.from_id = a2t.to_id
        WHERE
          a2t.type = 'actor_uses_technique'
          AND a2t.from_kind = 'actor'
          AND a2t.to_kind = 'technique'
        GROUP BY a2t.from_id
      ),
      origin AS (
        SELECT DISTINCT ON (from_id)
          from_id AS "actorId",
          to_id AS "originIso2"
        FROM kg_relations
        WHERE type = 'actor_origin_country' AND from_kind = 'actor' AND to_kind = 'country'
        ORDER BY from_id, support DESC, last_seen DESC
      )
      SELECT
        a."actorId" AS "actorId",
        a."name" AS "name",
        a."aliases" AS "aliases",
        a."description" AS "description",
        a."attributes" AS "attributes",
        a."createdAt" AS "createdAt",
        a."updatedAt" AS "updatedAt",
        o."originIso2" AS "originIso2",
        rs."lastSeen" AS "lastSeen",
        coalesce(rs."ttpCount", 0) AS "ttpCount",
        coalesce(mc."mitigationCount", 0) AS "mitigationCount",
        coalesce(rs."cveCount", 0) AS "cveCount",
        coalesce(rs."sectorCount", 0) AS "sectorCount"
      FROM actors a
      LEFT JOIN rel_stats rs ON rs."actorId" = a."actorId"
      LEFT JOIN mitigation_counts mc ON mc."actorId" = a."actorId"
      LEFT JOIN origin o ON o."actorId" = a."actorId"
    `.trim(),
  },
  Relations: {
    name: "Relations",
    columns: [
      "relationId",
      "type",
      "fromKind",
      "fromId",
      "toKind",
      "toId",
      "support",
      "confidence",
      "firstSeen",
      "lastSeen",
      "attributes",
    ],
    sql: `
      SELECT
        id AS "relationId",
        type AS "type",
        from_kind AS "fromKind",
        from_id AS "fromId",
        to_kind AS "toKind",
        to_id AS "toId",
        support AS "support",
        confidence AS "confidence",
        first_seen AS "firstSeen",
        last_seen AS "lastSeen",
        attributes AS "attributes"
      FROM kg_relations
    `.trim(),
  },
  Evidence: {
    name: "Evidence",
    columns: ["evidenceId", "relationId", "documentId", "chunkId", "excerpt", "url", "publishedAt", "confidence", "createdAt"],
    sql: `
      SELECT
        id AS "evidenceId",
        relation_id AS "relationId",
        document_id AS "documentId",
        chunk_id AS "chunkId",
        excerpt AS "excerpt",
        url AS "url",
        published_at AS "publishedAt",
        confidence AS "confidence",
        created_at AS "createdAt"
      FROM kg_evidence
    `.trim(),
  },
  Documents: {
    name: "Documents",
    columns: ["id", "url", "title", "status", "publishedAt", "fetchedAt", "createdAt", "error"],
    sql: `
      SELECT
        id AS "id",
        url AS "url",
        title AS "title",
        status AS "status",
        published_at AS "publishedAt",
        fetched_at AS "fetchedAt",
        created_at AS "createdAt",
        error AS "error"
      FROM documents
    `.trim(),
  },
  Findings: {
    name: "Findings",
    columns: [
      "id",
      "agent",
      "title",
      "summary",
      "severity",
      "cvssScore",
      "cvssVector",
      "cveId",
      "mitreIds",
      "tags",
      "sourceUrl",
      "sourceTitle",
      "pocUrl",
      "pocLevel",
      "disclosureToExploitHours",
      "publishedAt",
      "createdAt",
    ],
    sql: `
      SELECT
        id AS "id",
        agent AS "agent",
        title AS "title",
        summary AS "summary",
        severity AS "severity",
        cvss_score AS "cvssScore",
        cvss_vector AS "cvssVector",
        cve_id AS "cveId",
        mitre_ids AS "mitreIds",
        tags AS "tags",
        source_url AS "sourceUrl",
        source_title AS "sourceTitle",
        poc_url AS "pocUrl",
        poc_level AS "pocLevel",
        disclosure_to_exploit_hours AS "disclosureToExploitHours",
        published_at AS "publishedAt",
        created_at AS "createdAt"
      FROM findings
    `.trim(),
  },
  Sources: {
    name: "Sources",
    columns: ["id", "type", "name", "url", "enabled", "reliability", "etag", "lastModified", "lastFetchedAt", "createdAt", "updatedAt"],
    sql: `
      SELECT
        id AS "id",
        type AS "type",
        name AS "name",
        url AS "url",
        enabled AS "enabled",
        reliability AS "reliability",
        etag AS "etag",
        last_modified AS "lastModified",
        last_fetched_at AS "lastFetchedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM sources
    `.trim(),
  },
};

export function listKqlTables() {
  return Object.keys(TABLES).sort((a, b) => a.localeCompare(b));
}

export function compileKqlToSql(query: KqlQuery, opts?: { defaultLimit?: number; maxLimit?: number }): CompiledKql {
  const defaultLimit = Math.max(1, Math.floor(opts?.defaultLimit ?? 200));
  const maxLimit = Math.max(defaultLimit, Math.floor(opts?.maxLimit ?? 2000));

  const plan = compileQuery(query, { defaultLimit, maxLimit }, { isRoot: true, depth: 0 });
  return { sql: plan.sql, params: plan.params, columns: plan.columns };
}

function compileQuery(
  query: KqlQuery,
  limits: { defaultLimit: number; maxLimit: number },
  ctx: { isRoot: boolean; depth: number }
): Plan {
  if (ctx.depth > 4) throw new KqlError("Query too deep (max join nesting is 4)");
  if (query.stages.length > 50) throw new KqlError("Query too complex (too many stages)");

  const def = resolveTable(query.table);

  let plan: Plan = {
    sql: def.sql,
    params: [],
    columns: [...def.columns],
  };

  let hasExplicitLimit = false;

  for (const stage of query.stages) {
    const res = applyStage(plan, stage, limits, ctx);
    plan = res.plan;
    if (res.addedLimit) hasExplicitLimit = true;
  }

  if (ctx.isRoot && !hasExplicitLimit) {
    plan = applyTake(plan, limits.defaultLimit);
  }

  // Wrap once at the very end so callers can embed it safely.
  return plan;
}

function resolveTable(name: string): TableDef {
  const direct = TABLES[name];
  if (direct) return direct;
  const key = Object.keys(TABLES).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key) return TABLES[key]!;
  throw new KqlError(`Unknown table: ${name}`);
}

function applyStage(
  plan: Plan,
  stage: KqlStage,
  limits: { defaultLimit: number; maxLimit: number },
  ctx: { isRoot: boolean; depth: number }
): { plan: Plan; addedLimit: boolean } {
  switch (stage.type) {
    case "where":
      return { plan: applyWhere(plan, stage.expr), addedLimit: false };
    case "project":
      return { plan: applyProject(plan, stage.items), addedLimit: false };
    case "take": {
      const n = clampLimit(stage.count, limits.maxLimit);
      return { plan: applyTake(plan, n), addedLimit: true };
    }
    case "sort":
      return { plan: applySort(plan, stage.items), addedLimit: false };
    case "join":
      return { plan: applyJoin(plan, stage.kind, stage.right, stage.on, limits, { depth: ctx.depth + 1 }), addedLimit: false };
    case "summarize":
      return { plan: applySummarize(plan, stage.aggs, stage.by), addedLimit: false };
    default:
      // exhaustive
      return { plan, addedLimit: false };
  }
}

function clampLimit(n: number, max: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(v, max);
}

function selectList(alias: string, cols: string[]) {
  return cols.map((c) => `${alias}.${qIdent(c)} AS ${qIdent(c)}`).join(", ");
}

function applyWhere(plan: Plan, expr: KqlExpr): Plan {
  const b = new SqlParams(plan.params);
  const e = compileExpr(expr, { alias: "t", columns: plan.columns, b });
  const sql = `SELECT ${selectList("t", plan.columns)} FROM (${plan.sql}) AS t WHERE ${e}`;
  return { sql, params: b.params, columns: plan.columns };
}

function applyProject(plan: Plan, items: Array<{ alias: string; expr: KqlValueExpr }>): Plan {
  const cols: string[] = [];
  const selects: string[] = [];
  for (const it of items) {
    const alias = it.alias;
    if (!alias) throw new KqlError("project: empty alias");
    if (!IDENT_RE.test(alias)) throw new KqlError(`project: invalid column name: ${alias}`);
    const v = it.expr;
    if (v.type !== "field") throw new KqlError("project: only field projections are supported");
    const field = resolveColumn(plan.columns, v.name, `project: unknown field ${v.name}`);
    cols.push(alias);
    selects.push(`t.${qIdent(field)} AS ${qIdent(alias)}`);
  }
  const sql = `SELECT ${selects.join(", ")} FROM (${plan.sql}) AS t`;
  return { sql, params: plan.params, columns: cols };
}

function applyTake(plan: Plan, count: number): Plan {
  const n = Math.max(1, Math.floor(count));
  const sql = `SELECT ${selectList("t", plan.columns)} FROM (${plan.sql}) AS t LIMIT ${n}`;
  return { sql, params: plan.params, columns: plan.columns };
}

function applySort(plan: Plan, items: Array<{ field: string; direction: "asc" | "desc" }>): Plan {
  if (items.length === 0) return plan;
  const parts: string[] = [];
  for (const it of items) {
    const field = resolveColumn(plan.columns, it.field, `sort: unknown field ${it.field}`);
    const dir = it.direction === "desc" ? "DESC" : "ASC";
    parts.push(`t.${qIdent(field)} ${dir}`);
  }
  const sql = `SELECT ${selectList("t", plan.columns)} FROM (${plan.sql}) AS t ORDER BY ${parts.join(", ")}`;
  return { sql, params: plan.params, columns: plan.columns };
}

function applyJoin(
  planLeft: Plan,
  kind: "inner" | "left" | "right" | "full",
  right: KqlQuery,
  on: any,
  limits: { defaultLimit: number; maxLimit: number },
  ctx: { depth: number }
): Plan {
  const planRight = compileQuery(right, limits, { isRoot: false, depth: ctx.depth });

  const rightSql = shiftPlaceholders(planRight.sql, planLeft.params.length);
  const params = [...planLeft.params, ...planRight.params];

  const joinKeyword =
    kind === "left" ? "LEFT JOIN" : kind === "right" ? "RIGHT JOIN" : kind === "full" ? "FULL JOIN" : "INNER JOIN";

  const leftCols = planLeft.columns;
  const rightCols = planRight.columns;

  const outCols: string[] = [];
  const outSelects: string[] = [];

  const used = new Set<string>();
  for (const c of leftCols) {
    outCols.push(c);
    used.add(c);
    outSelects.push(`l.${qIdent(c)} AS ${qIdent(c)}`);
  }
  for (const c of rightCols) {
    let out = c;
    if (used.has(out)) out = `right_${out}`;
    // If we still collide (e.g. right_right_name) keep prefixing.
    while (used.has(out)) out = `right_${out}`;
    outCols.push(out);
    used.add(out);
    outSelects.push(`r.${qIdent(c)} AS ${qIdent(out)}`);
  }

  const onSql = compileJoinOn(on, { leftColumns: leftCols, rightColumns: rightCols });

  const sql = `
    SELECT ${outSelects.join(", ")}
    FROM (${planLeft.sql}) AS l
    ${joinKeyword} (${rightSql}) AS r
      ON ${onSql}
  `.trim();

  return { sql, params, columns: outCols };
}

function compileJoinOn(on: any, ctx: { leftColumns: string[]; rightColumns: string[] }): string {
  if (on.type === "using") {
    const fields: string[] = on.fields ?? [];
    if (!fields.length) throw new KqlError("join on: empty key list");
    const parts = fields.map((f) => {
      const l = resolveColumn(ctx.leftColumns, f, `join on: unknown left field ${f}`);
      const r = resolveColumn(ctx.rightColumns, f, `join on: unknown right field ${f}`);
      return `l.${qIdent(l)} = r.${qIdent(r)}`;
    });
    return parts.join(" AND ");
  }
  if (on.type === "on") {
    const conds = on.conditions as Array<{ left: KqlJoinFieldRef; right: KqlJoinFieldRef }>;
    if (!conds?.length) throw new KqlError("join on: missing conditions");
    const parts = conds.map((c) => {
      const l = compileJoinFieldRef(c.left, ctx);
      const r = compileJoinFieldRef(c.right, ctx);
      return `${l} = ${r}`;
    });
    return parts.join(" AND ");
  }
  throw new KqlError("join on: invalid syntax");
}

function compileJoinFieldRef(ref: KqlJoinFieldRef, ctx: { leftColumns: string[]; rightColumns: string[] }) {
  if (ref.side === "left") {
    const f = resolveColumn(ctx.leftColumns, ref.field, `join on: unknown left field ${ref.field}`);
    return `l.${qIdent(f)}`;
  }
  const f = resolveColumn(ctx.rightColumns, ref.field, `join on: unknown right field ${ref.field}`);
  return `r.${qIdent(f)}`;
}

function applySummarize(plan: Plan, aggs: KqlAgg[], by: string[]): Plan {
  const group = (by ?? []).filter(Boolean);
  const groupResolved = group.map((f) => resolveColumn(plan.columns, f, `summarize by: unknown field ${f}`));

  const selects: string[] = [];
  const outCols: string[] = [];

  for (const f of groupResolved) {
    selects.push(`t.${qIdent(f)} AS ${qIdent(f)}`);
    outCols.push(f);
  }

  for (const a of aggs) {
    if (!a.alias) throw new KqlError("summarize: missing aggregate alias");
    if (!IDENT_RE.test(a.alias)) throw new KqlError(`summarize: invalid column name: ${a.alias}`);

    const expr = compileAgg(plan.columns, a);
    selects.push(`${expr} AS ${qIdent(a.alias)}`);
    outCols.push(a.alias);
  }

  const groupBy = groupResolved.length ? ` GROUP BY ${groupResolved.map((f) => `t.${qIdent(f)}`).join(", ")}` : "";
  const sql = `SELECT ${selects.join(", ")} FROM (${plan.sql}) AS t${groupBy}`;
  return { sql, params: plan.params, columns: outCols };
}

function compileAgg(columns: string[], agg: KqlAgg): string {
  switch (agg.fn) {
    case "count":
      return "count(*)";
    case "dcount": {
      const f = agg.arg ?? null;
      if (!f) throw new KqlError("dcount() requires an argument");
      const col = resolveColumn(columns, f, `dcount: unknown field ${f}`);
      return `count(distinct t.${qIdent(col)})`;
    }
    case "sum":
    case "avg":
    case "min":
    case "max": {
      const f = agg.arg ?? null;
      if (!f) throw new KqlError(`${agg.fn}() requires an argument`);
      const col = resolveColumn(columns, f, `${agg.fn}: unknown field ${f}`);
      return `${agg.fn}(t.${qIdent(col)})`;
    }
    default:
      throw new KqlError(`Unsupported aggregate: ${(agg as any).fn}`);
  }
}

function resolveColumn(columns: string[], name: string, message: string): string {
  if (columns.includes(name)) return name;
  const found = columns.find((c) => c.toLowerCase() === name.toLowerCase());
  if (found) return found;
  throw new KqlError(message);
}

function compileExpr(expr: KqlExpr, ctx: { alias: string; columns: string[]; b: SqlParams }): string {
  switch (expr.type) {
    case "literal":
      return expr.value ? "TRUE" : "FALSE";
    case "and":
      return `(${compileExpr(expr.left, ctx)} AND ${compileExpr(expr.right, ctx)})`;
    case "or":
      return `(${compileExpr(expr.left, ctx)} OR ${compileExpr(expr.right, ctx)})`;
    case "not":
      return `(NOT ${compileExpr(expr.expr, ctx)})`;
    case "fn":
      return compileBoolFn(expr.fn, expr.args, ctx);
    case "compare":
      return compileCompare(expr.op, expr.left, expr.right, ctx);
    default:
      throw new KqlError("Unsupported expression");
  }
}

function compileBoolFn(fn: string, args: KqlValueExpr[], ctx: { alias: string; columns: string[]; b: SqlParams }): string {
  if (fn === "isnull" || fn === "isnotnull") {
    if (args.length !== 1) throw new KqlError(`${fn}() expects 1 argument`);
    const a = args[0]!;
    if (a.type !== "field") throw new KqlError(`${fn}() expects a field`);
    const col = resolveColumn(ctx.columns, a.name, `${fn}: unknown field ${a.name}`);
    return fn === "isnull" ? `${ctx.alias}.${qIdent(col)} IS NULL` : `${ctx.alias}.${qIdent(col)} IS NOT NULL`;
  }
  if (fn === "contains" || fn === "startswith" || fn === "endswith") {
    if (args.length !== 2) throw new KqlError(`${fn}() expects 2 arguments`);
    const left = args[0]!;
    const right = args[1]!;
    return compileCompare(fn as any, left, right, ctx);
  }
  throw new KqlError(`Unknown function: ${fn}`);
}

function compileCompare(
  op: string,
  left: KqlValueExpr,
  right: KqlValueExpr | KqlValueExpr[],
  ctx: { alias: string; columns: string[]; b: SqlParams }
): string {
  if (op === "in") {
    if (left.type !== "field") throw new KqlError("in: left side must be a field");
    const col = resolveColumn(ctx.columns, left.name, `in: unknown field ${left.name}`);
    const items = Array.isArray(right) ? right : [right];
    if (items.length === 0) return "FALSE";
    const placeholders = items.map((v) => {
      if (v.type === "null") return "NULL";
      if (v.type === "field") throw new KqlError("in: values must be literals");
      return ctx.b.add(v.type === "string" ? v.value : v.type === "number" ? v.value : v.type === "boolean" ? v.value : null);
    });
    return `${ctx.alias}.${qIdent(col)} IN (${placeholders.join(", ")})`;
  }

  // value comparisons
  const l = compileValue(left, ctx);

  if (Array.isArray(right)) throw new KqlError(`${op}: unexpected list`);
  const rExpr = right;

  if (op === "contains" || op === "startswith" || op === "endswith") {
    if (left.type !== "field") throw new KqlError(`${op}: left side must be a field`);
    const col = resolveColumn(ctx.columns, left.name, `${op}: unknown field ${left.name}`);
    if (rExpr.type === "field") throw new KqlError(`${op}: right side must be a literal`);
    if (rExpr.type === "null") return "FALSE";
    const ph = ctx.b.add(rExpr.type === "string" ? rExpr.value : String(rExpr.value));
    if (op === "contains") return `${ctx.alias}.${qIdent(col)} ILIKE ('%' || ${ph} || '%')`;
    if (op === "startswith") return `${ctx.alias}.${qIdent(col)} ILIKE (${ph} || '%')`;
    return `${ctx.alias}.${qIdent(col)} ILIKE ('%' || ${ph})`;
  }

  // Null-aware equality
  if (rExpr.type === "null") {
    if (op === "==" ) return `${l} IS NULL`;
    if (op === "!=") return `${l} IS NOT NULL`;
  }

  const r = compileValue(rExpr, ctx);
  const sqlOp = op === "==" ? "=" : op === "!=" ? "<>" : op;
  if (!["=", "<>", ">=", "<=", ">", "<"].includes(sqlOp)) throw new KqlError(`Unsupported operator: ${op}`);
  return `${l} ${sqlOp} ${r}`;
}

function compileValue(v: KqlValueExpr, ctx: { alias: string; columns: string[]; b: SqlParams }): string {
  switch (v.type) {
    case "field":
      return `${ctx.alias}.${qIdent(resolveColumn(ctx.columns, v.name, `Unknown field: ${v.name}`))}`;
    case "string":
      return ctx.b.add(v.value);
    case "number":
      return ctx.b.add(v.value);
    case "boolean":
      return ctx.b.add(v.value);
    case "null":
      return "NULL";
    default:
      throw new KqlError("Unsupported value");
  }
}
