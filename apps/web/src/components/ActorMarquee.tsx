import Link from "next/link";

type ActorRow = {
  actorId: string;
  name: string;
  originIso2: string | null;
  ttpCount: number;
  mitigationCount: number;
  cveCount: number;
  sectorCount: number;
  lastSeen: string | null;
};

function getCountryName(iso2: string) {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

function ActorCard({ row }: { row: ActorRow }) {
  const originLabel = row.originIso2 ? getCountryName(row.originIso2) : "Unknown";
  const originValue = row.originIso2 ? `${originLabel} (${row.originIso2})` : originLabel;

  return (
    <Link
      href={`/actors/${row.actorId}`}
      className="group block min-w-[340px] max-w-[420px] rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-950/40 backdrop-blur px-5 py-4 transition-colors hover:bg-white/90 dark:hover:bg-zinc-950/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {row.name}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500 tabular-nums">
            {row.actorId}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">Origin</div>
          <div className="text-xs text-zinc-800 dark:text-zinc-200 truncate max-w-[150px]">
            {originValue}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">TTPs</div>
          <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {row.ttpCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">Mitigations</div>
          <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {row.mitigationCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">CVEs</div>
          <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {row.cveCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500">Sectors</div>
          <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {row.sectorCount}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ActorStrip({ items }: { items: ActorRow[] }) {
  return (
    <div className="overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-5 pr-8">
        {items.map((row) => (
          <ActorCard key={row.actorId} row={row} />
        ))}
      </div>
    </div>
  );
}

export function ActorMarquee({ rows }: { rows: ActorRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/30 px-6 py-10 text-sm text-zinc-600 dark:text-zinc-400">
        No actors found.
      </div>
    );
  }

  const row1 = rows.filter((_, i) => i % 3 === 0);
  const row2 = rows.filter((_, i) => i % 3 === 1);
  const row3 = rows.filter((_, i) => i % 3 === 2);

  return (
    <section className="space-y-5">
      <ActorStrip items={row1.length ? row1 : rows} />
      <ActorStrip items={row2.length ? row2 : rows} />
      <ActorStrip items={row3.length ? row3 : rows} />
    </section>
  );
}
