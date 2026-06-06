"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CROWN_JEWELS, RISK_APPETITES, parseStackText, type CrownJewel, type CrownJewelId, type NavigatorRiskAppetite } from "../../lib/navigator";

type SectorOption = { id: string; name: string };

export function NavigatorSetupForm(params: {
  projectSlug: string;
  sectorOptions: SectorOption[];
  initial: {
    sector: string;
    riskAppetite: NavigatorRiskAppetite;
    crownJewels: unknown;
    stack: Array<{ technology: string; versionRange: string | null }>;
  };
}) {
  const router = useRouter();
  const initialCrownJewels = useMemo(() => {
    const raw = params.initial.crownJewels;
    if (!Array.isArray(raw)) return [] as CrownJewel[];
    return raw
      .map((x) => ({ id: String((x as any)?.id) as CrownJewelId, weight: Number((x as any)?.weight ?? 3) }))
      .filter((x) => CROWN_JEWELS.some((o) => o.id === x.id))
      .map((x) => ({ ...x, weight: Math.max(1, Math.min(5, Math.round(x.weight))) }))
      .slice(0, 3);
  }, [params.initial.crownJewels]);

  const [sector, setSector] = useState(params.initial.sector ?? "all");
  const [riskAppetite, setRiskAppetite] = useState<NavigatorRiskAppetite>(
    (params.initial.riskAppetite ?? "balanced") as NavigatorRiskAppetite
  );
  const [crownJewels, setCrownJewels] = useState<CrownJewel[]>(initialCrownJewels);
  const [stackText, setStackText] = useState(
    (params.initial.stack ?? [])
      .map((s) => (s.versionRange ? `${s.technology},${s.versionRange}` : s.technology))
      .join("\n")
  );

  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({
    kind: "idle",
  });

  const selectedCrownJewelIds = new Set(crownJewels.map((c) => c.id));
  const remainingSlots = 3 - crownJewels.length;

  const toggleCrownJewel = (id: CrownJewelId) => {
    setCrownJewels((prev) => {
      if (prev.some((c) => c.id === id)) return prev.filter((c) => c.id !== id);
      if (prev.length >= 3) return prev;
      return [...prev, { id, weight: 3 }];
    });
  };

  const setCrownJewelWeight = (id: CrownJewelId, weight: number) => {
    setCrownJewels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, weight: Math.max(1, Math.min(5, Math.round(weight))) } : c))
    );
  };

  const onSave = async () => {
    setStatus({ kind: "saving" });
    try {
      const stack = parseStackText(stackText);
      const res = await fetch("/api/navigator/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ti-project-slug": params.projectSlug },
        body: JSON.stringify({ sector, riskAppetite, crownJewels, stack, includeInferred: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setStatus({ kind: "saved", message: `Generated ${data.totalScenarios ?? 0} scenarios.` });
      router.push(`/p/${params.projectSlug}/navigator`);
      router.refresh();
    } catch (err: any) {
      setStatus({ kind: "error", message: String(err?.message ?? err) });
    }
  };

  return (
    <div className="max-w-[90ch] mx-auto px-8 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Navigator setup</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Provide a few inputs and get evidence-backed scenarios with CTEM-ready actions.
          </p>
        </div>
        <a
          href={`/p/${params.projectSlug}/navigator`}
          className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Skip
        </a>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Scope
          </h2>

          <label className="mt-4 block text-sm text-zinc-700 dark:text-zinc-300">
            Sector
            <select
              className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            >
              {params.sectorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-sm text-zinc-700 dark:text-zinc-300">
            Risk appetite
            <select
              className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              value={riskAppetite}
              onChange={(e) => setRiskAppetite(e.target.value as NavigatorRiskAppetite)}
            >
              {RISK_APPETITES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-zinc-500">
              {RISK_APPETITES.find((r) => r.id === riskAppetite)?.help}
            </div>
          </label>
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Crown jewels (pick up to 3)
          </h2>
          <div className="mt-4 space-y-3">
            {CROWN_JEWELS.map((cj) => {
              const selected = selectedCrownJewelIds.has(cj.id);
              const weight = crownJewels.find((c) => c.id === cj.id)?.weight ?? 3;
              return (
                <div
                  key={cj.id}
                  className={`rounded-lg border px-3 py-3 ${
                    selected
                      ? "border-sky-300/60 dark:border-sky-700/60 bg-sky-50/60 dark:bg-sky-950/20"
                      : "border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selected && remainingSlots <= 0}
                        onChange={() => toggleCrownJewel(cj.id)}
                        className="mt-1"
                      />
                      <span>
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{cj.label}</div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{cj.description}</div>
                      </span>
                    </label>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-zinc-500">weight</span>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={weight}
                        disabled={!selected}
                        onChange={(e) => setCrownJewelWeight(cj.id, Number(e.target.value))}
                        className="w-16 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-2 py-1 text-sm tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/30 p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
          Stack (CSV paste supported)
        </h2>
        <p className="mt-2 text-xs text-zinc-500">
          One per line. Optional version after a comma: <span className="font-mono">nginx,1.18</span>
        </p>
        <textarea
          value={stackText}
          onChange={(e) => setStackText(e.target.value)}
          rows={10}
          className="mt-3 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm font-mono"
          placeholder={`nginx\nwindows server\nkubernetes,>=1.27\nexchange`}
        />
      </section>

      <div className="mt-6 flex items-center justify-between gap-4">
        <div className="text-sm">
          {status.kind === "error" ? (
            <span className="text-red-600 dark:text-red-400">{status.message}</span>
          ) : status.kind === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400">{status.message}</span>
          ) : status.kind === "saving" ? (
            <span className="text-zinc-500">Saving…</span>
          ) : (
            <span className="text-zinc-500"> </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={status.kind === "saving"}
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-60"
        >
          Save &amp; generate scenarios
        </button>
      </div>
    </div>
  );
}
