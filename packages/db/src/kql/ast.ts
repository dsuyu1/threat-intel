export type KqlQuery = {
  table: string;
  stages: KqlStage[];
};

export type KqlStage =
  | { type: "where"; expr: KqlExpr }
  | { type: "project"; items: Array<{ alias: string; expr: KqlValueExpr }> }
  | { type: "take"; count: number }
  | { type: "sort"; items: Array<{ field: string; direction: "asc" | "desc" }> }
  | { type: "join"; kind: KqlJoinKind; right: KqlQuery; on: KqlJoinOn }
  | { type: "summarize"; aggs: KqlAgg[]; by: string[] };

export type KqlJoinKind = "inner" | "left" | "right" | "full";

export type KqlJoinOn =
  | { type: "using"; fields: string[] }
  | { type: "on"; conditions: Array<{ left: KqlJoinFieldRef; right: KqlJoinFieldRef }> };

export type KqlJoinFieldRef = { side: "left" | "right"; field: string };

export type KqlAgg = {
  alias: string;
  fn: "count" | "dcount" | "sum" | "avg" | "min" | "max";
  arg?: string | null;
};

export type KqlExpr =
  | { type: "and"; left: KqlExpr; right: KqlExpr }
  | { type: "or"; left: KqlExpr; right: KqlExpr }
  | { type: "not"; expr: KqlExpr }
  | { type: "compare"; op: KqlCompareOp; left: KqlValueExpr; right: KqlValueExpr | KqlValueExpr[] }
  | { type: "fn"; fn: KqlBoolFn; args: KqlValueExpr[] }
  | { type: "literal"; value: boolean };

export type KqlCompareOp = "==" | "!=" | ">=" | "<=" | ">" | "<" | "contains" | "startswith" | "endswith" | "in";

export type KqlBoolFn = "contains" | "startswith" | "endswith" | "isnull" | "isnotnull";

export type KqlValueExpr =
  | { type: "field"; name: string }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null" };

