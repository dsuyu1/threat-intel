export const runtime = "edge";
export const dynamic = "force-dynamic";

import { requireApiKey } from "../../../../lib/api-auth";

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
  const collections = `${u.origin}/taxii2/root/collections/`;

  return taxiiJson({
    title: "Default TAXII root",
    description: "Threat Intel read-only collections.",
    versions: ["taxii-2.1"],
    max_content_length: 10_485_760,
    collections,
  });
}

