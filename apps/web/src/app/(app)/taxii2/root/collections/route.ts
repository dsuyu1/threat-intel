export const runtime = "edge";
export const dynamic = "force-dynamic";

import { requireApiKey } from "../../../../../lib/api-auth";

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

  const base = `${u.origin}/taxii2/root/collections`;
  const mediaTypes = ["application/stix+json;version=2.1"];

  return taxiiJson({
    collections: [
      {
        id: "findings",
        title: "Findings",
        description: "Platform findings (PoCs are grouped by CVE).",
        can_read: true,
        can_write: false,
        media_types: mediaTypes,
        objects: `${base}/findings/objects/`,
      },
      {
        id: "actors",
        title: "Actors",
        description: "Threat actor intelligence.",
        can_read: true,
        can_write: false,
        media_types: mediaTypes,
        objects: `${base}/actors/objects/`,
      },
    ],
  });
}

