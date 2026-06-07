export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, playbooks } from "@ti/db";
import { desc, eq } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "../../../../components/ui/Card";
import { getViewerContext } from "../../../../lib/tenancy";

function safeDate(d: Date | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

function incidentLabel(v: string) {
  const x = String(v ?? "");
  if (x === "vulnerability_exploitation") return "Vuln exploitation";
  if (x === "credential_compromise") return "Credential compromise";
  if (x === "lateral_movement") return "Lateral movement";
  if (x === "data_exfiltration") return "Data exfiltration";
  if (x === "ransomware") return "Ransomware";
  if (x === "supply_chain") return "Supply chain";
  return x;
}

function statusPill(status: string) {
  const s = String(status ?? "");
  if (s === "approved") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (s === "archived") return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
  return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200";
}

export default async function PlaybooksPage({ params }: { params: Promise<{ projectSlug: string }> }) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });

  let rows: Array<{
    id: string;
    title: string;
    incidentType: string;
    status: string;
    updatedAt: Date;
    createdAt: Date;
  }> = [];
  let missing = false;
  try {
    rows = await db
      .select({
        id: playbooks.id,
        title: playbooks.title,
        incidentType: playbooks.incidentType,
        status: playbooks.status,
        updatedAt: playbooks.updatedAt,
        createdAt: playbooks.createdAt,
      })
      .from(playbooks)
      .where(eq(playbooks.projectId, ctx.project.id))
      .orderBy(desc(playbooks.updatedAt), desc(playbooks.createdAt))
      .limit(200);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") missing = true;
    else throw err;
  }

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Playbooks</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-[80ch]">
            Draft incident response playbooks generated from live intel and your configured stack. Review, approve, and run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/p/${p.projectSlug}/playbooks/new`}
            className="h-10 inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 text-sm font-medium hover:opacity-95"
          >
            Generate playbook
          </Link>
        </div>
      </header>

      {missing ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Playbooks tables are missing. Run <span className="font-mono">pnpm db:migrate</span>.
        </div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.length ? (
          rows.map((pb) => (
            <Card key={pb.id} className="hover:shadow-2xl transition-shadow">
              <CardHeader
                title={<span className="text-base">{pb.title}</span>}
                description={`${incidentLabel(pb.incidentType)} · Updated ${safeDate(pb.updatedAt ?? pb.createdAt)}`}
                right={
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusPill(pb.status)}`}>
                    {pb.status}
                  </span>
                }
              />
              <CardContent>
                <Link
                  href={`/p/${p.projectSlug}/playbooks/${pb.id}`}
                  className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40 transition-colors"
                >
                  Open
                </Link>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 text-sm text-zinc-600 dark:text-zinc-400">
            No playbooks yet. Generate one from a Navigator scenario or start from scratch.
          </div>
        )}
      </section>
    </div>
  );
}

