import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";

type OnDemandKind = "system" | "custom";

type OnDemandEventV1 = {
  version?: 1;
  runId?: string;
  kind?: OnDemandKind;
  agentKey?: string;
  customAgentId?: string;
  projectId?: string;
  userId?: string;
  scenarioId?: string;
  connectionId?: string;
  force?: boolean;
};

function json(statusCode: number, data: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

function readHeader(headers: APIGatewayProxyEventV2["headers"], name: string): string {
  if (!headers) return "";
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== target) continue;
    return String(v ?? "").trim();
  }
  return "";
}

function readBearerToken(headers: APIGatewayProxyEventV2["headers"]): string {
  const auth = readHeader(headers, "authorization");
  if (!auth) return "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] ?? "").trim();
}

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function validatePayload(payload: OnDemandEventV1): { ok: true } | { ok: false; error: string } {
  const kind = asString(payload.kind).toLowerCase();
  const runId = asString(payload.runId);

  if (kind !== "system" && kind !== "custom") return { ok: false, error: "kind must be 'system' or 'custom'" };
  if (!runId) return { ok: false, error: "runId is required" };

  if (kind === "system") {
    if (!asString(payload.agentKey)) return { ok: false, error: "agentKey is required for system runs" };
  } else {
    if (!asString(payload.customAgentId)) return { ok: false, error: "customAgentId is required for custom runs" };
  }

  return { ok: true };
}

export const handler = async (event: APIGatewayProxyEventV2, _ctx: Context): Promise<APIGatewayProxyResultV2> => {
  const expectedSecret = String(process.env["AGENTS_ON_DEMAND_SECRET"] ?? "").trim();
  if (!expectedSecret) {
    return json(503, { error: "AGENTS_ON_DEMAND_SECRET is not configured" });
  }

  const providedSecret = readBearerToken(event.headers) || readHeader(event.headers, "x-ti-agent-secret");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return json(401, { error: "Unauthorized" });
  }

  const runnerFunctionName = String(process.env["ON_DEMAND_RUNNER_FUNCTION_NAME"] ?? "").trim();
  if (!runnerFunctionName) {
    return json(503, { error: "ON_DEMAND_RUNNER_FUNCTION_NAME is not configured" });
  }

  const rawBody = event.body ?? "";
  const decodedBody = event.isBase64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;

  let payload: OnDemandEventV1;
  try {
    payload = JSON.parse(decodedBody || "{}") as OnDemandEventV1;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const validation = validatePayload(payload);
  if (!validation.ok) return json(400, { error: validation.error });

  const client = new LambdaClient({});
  await client.send(
    new InvokeCommand({
      FunctionName: runnerFunctionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload), "utf8"),
    })
  );

  return json(202, { ok: true });
};
