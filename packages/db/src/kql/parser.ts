import type {
  KqlAgg,
  KqlBoolFn,
  KqlCompareOp,
  KqlExpr,
  KqlJoinFieldRef,
  KqlJoinKind,
  KqlJoinOn,
  KqlQuery,
  KqlStage,
  KqlValueExpr,
} from "./ast";
import { KqlError } from "./errors";
import type { Token } from "./tokenize";
import { tokenizeKql } from "./tokenize";

const KEYWORDS = new Set([
  "where",
  "project",
  "take",
  "limit",
  "sort",
  "by",
  "join",
  "kind",
  "on",
  "summarize",
  "and",
  "or",
  "not",
  "asc",
  "desc",
  "true",
  "false",
  "null",
]);

function isKeyword(t: Token, kw: string) {
  return t.kind === "identifier" && t.value.toLowerCase() === kw;
}

function normalizeIdent(v: string) {
  return v.trim();
}

function parseJoinKind(raw: string, pos: number): KqlJoinKind {
  const v = raw.toLowerCase();
  if (v === "inner") return "inner";
  if (v === "left" || v === "leftouter") return "left";
  if (v === "right" || v === "rightouter") return "right";
  if (v === "full" || v === "fullouter") return "full";
  throw new KqlError(`Unsupported join kind: ${raw}`, pos);
}

export function parseKql(input: string): KqlQuery {
  const tokens = tokenizeKql(input);
  const p = new Parser(tokens);
  const q = p.parseQuery("eof");
  p.expect("eof");
  return q;
}

class Parser {
  private i = 0;

  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private consume(): Token {
    const t = this.tokens[this.i]!;
    this.i++;
    return t;
  }

  private match(kind: Token["kind"], value?: any): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value != null && (t as any).value !== value) return false;
    return true;
  }

  private matchKeyword(kw: string): boolean {
    return isKeyword(this.peek(), kw);
  }

  expect(kind: "identifier", value?: any): Extract<Token, { kind: "identifier" }>;
  expect(kind: "number", value?: any): Extract<Token, { kind: "number" }>;
  expect(kind: "string", value?: any): Extract<Token, { kind: "string" }>;
  expect(kind: "op", value?: any): Extract<Token, { kind: "op" }>;
  expect(kind: "pipe", value?: any): Extract<Token, { kind: "pipe" }>;
  expect(kind: "comma", value?: any): Extract<Token, { kind: "comma" }>;
  expect(kind: "lparen", value?: any): Extract<Token, { kind: "lparen" }>;
  expect(kind: "rparen", value?: any): Extract<Token, { kind: "rparen" }>;
  expect(kind: "eof", value?: any): Extract<Token, { kind: "eof" }>;
  expect(kind: Token["kind"], value?: any): Token;
  expect(kind: Token["kind"], value?: any): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new KqlError(`Expected ${kind}`, t.pos);
    if (value != null && (t as any).value !== value)
      throw new KqlError(`Expected ${String(value)}`, t.pos);
    return this.consume() as any;
  }

  private expectIdentifier(): Token & { kind: "identifier" } {
    const t = this.peek();
    if (t.kind !== "identifier") throw new KqlError("Expected identifier", t.pos);
    return this.consume() as any;
  }

  parseQuery(stopAt: "eof" | "rparen"): KqlQuery {
    const t = this.expectIdentifier();
    const table = normalizeIdent(t.value);
    if (!table) throw new KqlError("Missing table name", t.pos);

    const stages: KqlStage[] = [];
    while (true) {
      const nxt = this.peek();
      if (stopAt === "rparen" && nxt.kind === "rparen") break;
      if (stopAt === "eof" && nxt.kind === "eof") break;
      if (!this.match("pipe")) break;
      this.consume(); // |
      stages.push(this.parseStage());
    }
    return { table, stages };
  }

  private parseStage(): KqlStage {
    const t = this.peek();
    if (t.kind !== "identifier") throw new KqlError("Expected stage keyword", t.pos);
    const kw = t.value.toLowerCase();
    if (!KEYWORDS.has(kw)) throw new KqlError(`Unknown stage: ${t.value}`, t.pos);

    switch (kw) {
      case "where":
        this.consume();
        return { type: "where", expr: this.parseExpr() };
      case "project":
        this.consume();
        return { type: "project", items: this.parseProjectList() };
      case "take":
      case "limit": {
        this.consume();
        const n = this.expect("number").value;
        return { type: "take", count: Math.floor(n) };
      }
      case "sort":
        this.consume();
        if (this.matchKeyword("by")) this.consume();
        return { type: "sort", items: this.parseSortList() };
      case "join":
        this.consume();
        return this.parseJoinStage();
      case "summarize":
        this.consume();
        return this.parseSummarizeStage();
      default:
        throw new KqlError(`Unsupported stage: ${t.value}`, t.pos);
    }
  }

  private parseProjectList(): Array<{ alias: string; expr: KqlValueExpr }> {
    const items: Array<{ alias: string; expr: KqlValueExpr }> = [];
    while (true) {
      const first = this.expectIdentifier();
      const name = normalizeIdent(first.value);
      if (!name) throw new KqlError("Empty projection", first.pos);

      if (this.match("op", "=")) {
        // alias = field
        this.consume();
        const rhs = this.parseValue();
        items.push({ alias: name, expr: rhs });
      } else {
        items.push({ alias: name, expr: { type: "field", name } });
      }

      if (this.match("comma")) {
        this.consume();
        continue;
      }
      break;
    }
    return items;
  }

  private parseSortList(): Array<{ field: string; direction: "asc" | "desc" }> {
    const items: Array<{ field: string; direction: "asc" | "desc" }> = [];
    while (true) {
      const f = this.expectIdentifier();
      const field = normalizeIdent(f.value);
      let direction: "asc" | "desc" = "asc";
      if (this.peek().kind === "identifier") {
        const d = (this.peek() as any).value.toLowerCase();
        if (d === "asc" || d === "desc") {
          direction = d;
          this.consume();
        }
      }
      items.push({ field, direction });
      if (this.match("comma")) {
        this.consume();
        continue;
      }
      break;
    }
    return items;
  }

  private parseJoinStage(): KqlStage {
    let kind: KqlJoinKind = "inner";

    // Options (only kind=... for now) until we hit '('
    while (this.peek().kind === "identifier" && !this.match("lparen")) {
      const key = (this.peek() as any).value.toLowerCase();
      if (key === "kind") {
        this.consume();
        this.expect("op", "=");
        const v = this.expectIdentifier();
        kind = parseJoinKind(v.value, v.pos);
        continue;
      }
      // unknown option; stop and expect '('
      break;
    }

    this.expect("lparen");
    const right = this.parseQuery("rparen");
    this.expect("rparen");

    if (!this.matchKeyword("on")) throw new KqlError("join: expected 'on'", this.peek().pos);
    this.consume();

    const on = this.parseJoinOn();
    return { type: "join", kind, right, on };
  }

  private parseJoinOn(): KqlJoinOn {
    // `on col1, col2` shorthand
    if (this.peek().kind === "identifier") {
      const save = this.i;
      const ids: string[] = [];
      const first = this.expectIdentifier();
      ids.push(normalizeIdent(first.value));
      while (this.match("comma")) {
        this.consume();
        const n = this.expectIdentifier();
        ids.push(normalizeIdent(n.value));
      }
      // If the next token looks like a comparator, this wasn't a "using" list.
      if (this.peek().kind === "op") {
        this.i = save;
      } else if (this.peek().kind === "identifier") {
        const maybeOp = (this.peek() as any).value.toLowerCase();
        if (maybeOp === "and" || maybeOp === "or" || maybeOp === "not") {
          // allow using-list to end before logical ops? no: join-on only supports equality. rewind.
          this.i = save;
        } else {
          return { type: "using", fields: ids };
        }
      } else {
        return { type: "using", fields: ids };
      }
    }

    const conditions: Array<{ left: KqlJoinFieldRef; right: KqlJoinFieldRef }> = [];
    while (true) {
      const left = this.parseJoinFieldRef();
      const op = this.expect("op");
      if (op.value !== "==" && op.value !== "=") throw new KqlError("join on: only == is supported", op.pos);
      const right = this.parseJoinFieldRef();
      conditions.push({ left, right });
      if (this.matchKeyword("and")) {
        this.consume();
        continue;
      }
      break;
    }
    return { type: "on", conditions };
  }

  private parseJoinFieldRef(): KqlJoinFieldRef {
    const t = this.expectIdentifier();
    const raw = normalizeIdent(t.value);
    const m = raw.match(/^\$(left|right)\.(.+)$/i);
    if (!m) throw new KqlError("join on: expected $left.<field> or $right.<field>", t.pos);
    const side = m[1]!.toLowerCase() === "left" ? "left" : "right";
    const field = m[2]!;
    return { side, field };
  }

  private parseSummarizeStage(): KqlStage {
    const aggs: KqlAgg[] = [];

    while (true) {
      const t = this.expectIdentifier();
      const name = normalizeIdent(t.value);

      let alias: string | null = null;
      let fnToken: string | null = null;
      let fnPos = t.pos;

      if (this.match("op", "=")) {
        // alias = fn(...)
        alias = name;
        this.consume();
        const fn = this.expectIdentifier();
        fnToken = normalizeIdent(fn.value);
        fnPos = fn.pos;
      } else {
        fnToken = name;
      }

      const fnLower = (fnToken ?? "").toLowerCase();
      const fn = this.parseAggFn(fnLower, fnPos);
      this.expect("lparen");
      let arg: string | null = null;
      if (!this.match("rparen")) {
        const v = this.parseValue();
        if (v.type !== "field") throw new KqlError(`summarize ${fnLower}() expects a field name`, fnPos);
        arg = v.name;
      }
      this.expect("rparen");

      const outAlias =
        alias ??
        (fn === "count"
          ? "count"
          : arg
            ? `${fn}_${arg}`
            : fn);

      aggs.push({ alias: outAlias, fn, arg });

      if (this.match("comma")) {
        this.consume();
        continue;
      }
      break;
    }

    const by: string[] = [];
    if (this.matchKeyword("by")) {
      this.consume();
      while (true) {
        const id = this.expectIdentifier();
        by.push(normalizeIdent(id.value));
        if (this.match("comma")) {
          this.consume();
          continue;
        }
        break;
      }
    }

    return { type: "summarize", aggs, by };
  }

  private parseAggFn(raw: string, pos: number): KqlAgg["fn"] {
    if (raw === "count") return "count";
    if (raw === "dcount") return "dcount";
    if (raw === "sum") return "sum";
    if (raw === "avg") return "avg";
    if (raw === "min") return "min";
    if (raw === "max") return "max";
    throw new KqlError(`Unsupported aggregate: ${raw}`, pos);
  }

  // ---- Expressions (where) ----

  private parseExpr(): KqlExpr {
    return this.parseOr();
  }

  private parseOr(): KqlExpr {
    let left = this.parseAnd();
    while (this.matchKeyword("or")) {
      this.consume();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): KqlExpr {
    let left = this.parseUnary();
    while (this.matchKeyword("and")) {
      this.consume();
      const right = this.parseUnary();
      left = { type: "and", left, right };
    }
    return left;
  }

  private parseUnary(): KqlExpr {
    if (this.matchKeyword("not")) {
      const t = this.consume();
      return { type: "not", expr: this.parseUnary() };
    }
    return this.parseComparisonOrPrimary();
  }

  private parseComparisonOrPrimary(): KqlExpr {
    if (this.match("lparen")) {
      this.consume();
      const e = this.parseExpr();
      this.expect("rparen");
      return e;
    }

    // boolean literals
    if (this.matchKeyword("true")) {
      this.consume();
      return { type: "literal", value: true };
    }
    if (this.matchKeyword("false")) {
      this.consume();
      return { type: "literal", value: false };
    }

    // function calls that return boolean
    if (this.peek().kind === "identifier") {
      const save = this.i;
      const id = this.expectIdentifier();
      const nameLower = id.value.toLowerCase();
      if (this.match("lparen")) {
        this.consume();
        const args: KqlValueExpr[] = [];
        if (!this.match("rparen")) {
          while (true) {
            args.push(this.parseValue());
            if (this.match("comma")) {
              this.consume();
              continue;
            }
            break;
          }
        }
        this.expect("rparen");
        const fn = this.parseBoolFn(nameLower, id.pos);
        return { type: "fn", fn, args };
      }
      // not a function; rewind
      this.i = save;
    }

    const left = this.parseValue();

    // keyword operators: contains/startswith/endswith/in
    if (this.peek().kind === "identifier") {
      const opTok = this.peek() as any;
      const opLower = opTok.value.toLowerCase();
      if (opLower === "contains" || opLower === "startswith" || opLower === "endswith") {
        this.consume();
        const right = this.parseValue();
        return { type: "compare", op: opLower as any, left, right };
      }
      if (opLower === "in") {
        this.consume();
        this.expect("lparen");
        const items: KqlValueExpr[] = [];
        if (!this.match("rparen")) {
          while (true) {
            items.push(this.parseValue());
            if (this.match("comma")) {
              this.consume();
              continue;
            }
            break;
          }
        }
        this.expect("rparen");
        return { type: "compare", op: "in", left, right: items };
      }
    }

    if (this.match("op")) {
      const op = this.consume() as any as Token & { kind: "op" };
      const mapped = this.mapCompareOp(op.value, op.pos);
      const right = this.parseValue();
      return { type: "compare", op: mapped, left, right };
    }

    throw new KqlError("Expected comparison in where clause", this.peek().pos);
  }

  private parseBoolFn(nameLower: string, pos: number): KqlBoolFn {
    if (nameLower === "contains") return "contains";
    if (nameLower === "startswith") return "startswith";
    if (nameLower === "endswith") return "endswith";
    if (nameLower === "isnull") return "isnull";
    if (nameLower === "isnotnull") return "isnotnull";
    throw new KqlError(`Unknown function: ${nameLower}`, pos);
  }

  private mapCompareOp(op: Extract<Token, { kind: "op" }>["value"], pos: number): KqlCompareOp {
    if (op === "=") return "==";
    if (op === "==" || op === "!=" || op === ">=" || op === "<=" || op === ">" || op === "<") return op as any;
    throw new KqlError(`Unsupported operator: ${op}`, pos);
  }

  private parseValue(): KqlValueExpr {
    const t = this.peek();
    if (t.kind === "string") {
      this.consume();
      return { type: "string", value: t.value };
    }
    if (t.kind === "number") {
      this.consume();
      return { type: "number", value: t.value };
    }
    if (t.kind === "identifier") {
      const v = t.value.toLowerCase();
      if (v === "true" || v === "false") {
        this.consume();
        return { type: "boolean", value: v === "true" };
      }
      if (v === "null") {
        this.consume();
        return { type: "null" };
      }
      this.consume();
      return { type: "field", name: normalizeIdent(t.value) };
    }
    throw new KqlError("Expected value", t.pos);
  }
}
