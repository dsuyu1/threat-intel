export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getViewerContext } from "../../../lib/tenancy";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PlaybooksNewRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getViewerContext();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = pickOne(v);
    if (!value) continue;
    params.set(k, String(value));
  }
  const qs = params.toString();

  redirect(qs ? `/p/${ctx.project.slug}/playbooks/new?${qs}` : `/p/${ctx.project.slug}/playbooks/new`);
}

