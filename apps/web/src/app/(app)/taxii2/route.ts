export const runtime = "edge";
export const dynamic = "force-dynamic";

import { requireApiKey } from "../../../lib/api-auth";

function taxiiJson(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/taxii+json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export async function GET(req: Request) {
  const auth = await requireApiKey(req, { scope: "taxii:read" });
  if (!auth.ok) return auth.res;

  const u = new URL(req.url);
  const root = `${u.origin}/taxii2/root/`;

  return taxiiJson({
    title: "Threat Intel TAXII 2.1",
    description: "Read-only TAXII feed for STIX bundles (findings + actors).",
    default: root,
    api_roots: [root],
  });
}

