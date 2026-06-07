export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getDb, playbooks } from "@ti/db";
import { and, eq } from "drizzle-orm";
import { PlaybookActions } from "../../../../../components/playbooks/PlaybookActions";
import { PlaybookDraftEditor } from "../../../../../components/playbooks/PlaybookDraftEditor";
import { PlaybookViewer } from "../../../../../components/playbooks/PlaybookViewer";
import type { PlaybookContentV1 } from "../../../../../lib/playbooks/types";
import { getViewerContext } from "../../../../../lib/tenancy";

function isPlaybookContentV1(value: unknown): value is PlaybookContentV1 {
  const v = value as any;
  return v && typeof v === "object" && v.version === 1 && typeof v.title === "string" && Array.isArray(v.phases);
}

function statusPill(status: string) {
  const s = String(status ?? "");
  if (s === "approved") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (s === "archived") return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
  return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200";
}

export default async function PlaybookPage({
  params,
}: {
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const db = getDb();
  const p = await params;
  const viewer = await getViewerContext({ projectSlug: p.projectSlug });

  let missing = false;
      let row:
    | {
        id: string;
        title: string;
        status: string;
        incidentType: string;
        contentJson: unknown;
        contentFormat: string;
        contentText: string | null;
        createdAt: Date;
        updatedAt: Date;
      }
    | null = null;
  try {
    [row] = await db
      .select({
        id: playbooks.id,
        title: playbooks.title,
        status: playbooks.status,
        incidentType: playbooks.incidentType,
        contentJson: playbooks.contentJson,
        contentFormat: playbooks.contentFormat,
        contentText: playbooks.contentText,
        createdAt: playbooks.createdAt,
        updatedAt: playbooks.updatedAt,
      })
      .from(playbooks)
      .where(and(eq(playbooks.id, p.id), eq(playbooks.projectId, viewer.project.id)))
      .limit(1);
  } catch (err) {
    const code = String((err as any)?.code ?? "");
    if (code === "42P01") missing = true;
    else throw err;
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-[90ch] px-8 py-10 space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Playbooks</h1>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Playbooks tables are missing. Run <span className="font-mono">pnpm db:migrate</span>.
        </div>
        <Link href={`/p/${p.projectSlug}/playbooks`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to playbooks
        </Link>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-[90ch] px-8 py-10 space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Playbook not found</h1>
        <Link href={`/p/${p.projectSlug}/playbooks`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to playbooks
        </Link>
      </div>
    );
  }

  const content = isPlaybookContentV1(row.contentJson) ? (row.contentJson as PlaybookContentV1) : null;
  const initialFormat = (row.contentFormat ? String(row.contentFormat) : "json") as any;
  const initialText =
    typeof row.contentText === "string" && row.contentText.trim()
      ? row.contentText
      : JSON.stringify(row.contentJson, null, 2);

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-10 space-y-6">
      <header className="space-y-3">
        <Link href={`/p/${p.projectSlug}/playbooks`} className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline">
          ← Back to playbooks
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{row.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className={`rounded-full border px-2 py-0.5 ${statusPill(row.status)}`}>{row.status}</span>
              <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">{row.incidentType}</span>
            </div>
          </div>
          {row.status === "draft" ? null : (
            <PlaybookActions projectSlug={p.projectSlug} playbookId={row.id} status={row.status as any} />
          )}
        </div>
      </header>

      {row.status === "draft" ? (
        <PlaybookDraftEditor
          projectSlug={p.projectSlug}
          playbookId={row.id}
          initialFormat={initialFormat}
          initialText={initialText}
        />
      ) : content ? (
        <PlaybookViewer content={content} />
      ) : (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Playbook content is in an unknown format. Regenerate the playbook.
        </div>
      )}
    </div>
  );
}
