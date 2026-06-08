import { describe, expect, it } from "vitest";

import { compileKqlToSql } from "./compiler";
import { parseKql } from "./parser";

describe("compileKqlToSql", () => {
  it("keeps WHERE clauses when applying additional stages", () => {
    const q = parseKql('Entities | where kind == "actor" | project entityId,kind | take 5');
    const compiled = compileKqlToSql(q);

    expect(compiled.columns).toEqual(["entityId", "kind"]);
    expect(compiled.sql).toContain('WHERE t."kind" = $1');
    expect(compiled.params).toEqual(["actor"]);
  });

  it("keeps WHERE clauses through summarize + take", () => {
    const q = parseKql('Entities | where kind == "actor" | summarize total=count() by kind | take 10');
    const compiled = compileKqlToSql(q);

    expect(compiled.sql).toContain('WHERE t."kind" = $1');
    expect(compiled.sql).toContain('GROUP BY t."kind"');
    expect(compiled.sql).toContain("LIMIT 10");
    expect(compiled.params).toEqual(["actor"]);
  });

  it("shifts placeholders correctly when joining queries with params on both sides", () => {
    const q = parseKql(
      'Entities | where kind == "actor" | join kind=inner (Relations | where type == "actor_uses_technique") on $left.entityId == $right.fromId | take 1'
    );
    const compiled = compileKqlToSql(q);

    expect(compiled.params).toEqual(["actor", "actor_uses_technique"]);
    expect(compiled.sql).toContain('WHERE t."kind" = $1');
    expect(compiled.sql).toContain('WHERE t."type" = $2');
    expect(compiled.sql).toContain('ON l."entityId" = r."fromId"');
  });

  it("enforces project scoping for Findings", () => {
    const q = parseKql('Findings | where severity == "high" | take 1');
    const compiled = compileKqlToSql(q, { projectId: "proj_123" });

    expect(compiled.sql).toContain('"project_finding_stack_matches"');
    expect(compiled.sql).toContain('scope."project_id" = $1');
    expect(compiled.sql).toContain('scope."finding_id" = t."id"');
    expect(compiled.sql).toContain('WHERE t."severity" = $2');
    expect(compiled.params).toEqual(["proj_123", "high"]);
  });

  it("rejects Findings queries without a project id", () => {
    const q = parseKql("Findings | take 1");
    expect(() => compileKqlToSql(q)).toThrow(/Missing project scope/i);
  });
});
