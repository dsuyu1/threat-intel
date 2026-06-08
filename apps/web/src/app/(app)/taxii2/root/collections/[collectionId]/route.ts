export const runtime = "edge";
export const dynamic = "force-dynamic";

import { requireApiKey } from "../../../../../../lib/api-auth";

function taxiiJson(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/taxii+json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ collectionId: string }> }) {
  const auth = await requireApiKey(req, { scope: "taxii:read" });
  if (!auth.ok) return auth.res;

  const { collectionId } = await ctx.params;
  const id = String(collectionId ?? "");
  if (id !== "findings" && id !== "actors") return taxiiJson({ error: "Not found" }, { status: 404 });

  const u = new URL(req.url);
  const base = `${u.origin}/taxii2/root/collections/${encodeURIComponent(id)}`;
  const mediaTypes = ["application/stix+json;version=2.1"];

  return taxiiJson({
    id,
    title: id === "findings" ? "Findings" : "Actors",
    can_read: true,
    can_write: false,
    media_types: mediaTypes,
    objects: `${base}/objects/`,
  });
}

