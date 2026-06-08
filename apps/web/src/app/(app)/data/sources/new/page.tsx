export const runtime = "edge";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/Card";
import { NewSourceForm } from "./ui/NewSourceForm";

export default function NewSourcePage() {
  return (
    <div className="mx-auto max-w-[980px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Add source</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Connect an RSS feed or STIX/TAXII endpoint so agents can ingest content.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Source details"
          description="Sources are global across your workspace. You can disable a source without deleting it."
        />
        <CardContent>
          <NewSourceForm />

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/data/sources" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Back to sources
            </Link>
            <Link href="/data/documents" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Verify ingestion in Documents
            </Link>
            <Link href="/learn/getting-started/connecting-data" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Read: Connecting data
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
