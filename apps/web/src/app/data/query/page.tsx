export const runtime = "edge";
export const dynamic = "force-dynamic";

import { KqlConsole } from "../../../components/KqlConsole";

export default function QueryPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Query console (KQL)
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Kusto-inspired pipeline syntax over your Postgres tables and KG. Tables: Actors, Relations, Evidence,
          Findings, Documents, Sources, Entities.
        </p>
      </header>

      <KqlConsole />
    </div>
  );
}

