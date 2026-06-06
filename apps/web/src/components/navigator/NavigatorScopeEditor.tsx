"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RISK_APPETITES, type NavigatorRiskAppetite } from "../../lib/navigator";

type SectorOption = { id: string; name: string };

function json(data: unknown, init?: RequestInit) {
  return {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(data),
  } satisfies RequestInit;
}

export function NavigatorScopeEditor(props: {
  projectSlug: string;
  sector: string;
  riskAppetite: NavigatorRiskAppetite;
  sectorOptions: SectorOption[];
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sector, setSector] = useState(props.sector);
  const [riskAppetite, setRiskAppetite] = useState<NavigatorRiskAppetite>(props.riskAppetite);

  useEffect(() => {
    setSector(props.sector);
  }, [props.sector]);

  useEffect(() => {
    setRiskAppetite(props.riskAppetite);
  }, [props.riskAppetite]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
      setError(null);
      setSector(props.sector);
      setRiskAppetite(props.riskAppetite);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, props.riskAppetite, props.sector]);

  const sectorLabel = useMemo(() => {
    const id = String(props.sector ?? "");
    return props.sectorOptions.find((s) => s.id === id)?.name ?? id;
  }, [props.sector, props.sectorOptions]);

  const appetiteLabel = useMemo(() => {
    return RISK_APPETITES.find((r) => r.id === props.riskAppetite)?.label ?? String(props.riskAppetite);
  }, [props.riskAppetite]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const recompute = sector !== props.sector;
      const res = await fetch(
        "/api/navigator/config",
        json(
          { sector, riskAppetite, recompute },
          { headers: { "x-ti-project-slug": props.projectSlug } }
        )
      );
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(String(data?.error ?? `Request failed (${res.status})`));
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Sector: <span className="font-medium">{sectorLabel}</span> • Appetite:{" "}
        <span className="font-medium">{appetiteLabel}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Edit Navigator scope"
          className="absolute right-0 mt-2 w-[min(340px,calc(100vw-32px))] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/10 dark:shadow-black/60 p-3"
        >
          <div className="grid grid-cols-1 gap-3">
            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Sector
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
              >
                {props.sectorOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
              Risk appetite
              <select
                value={riskAppetite}
                onChange={(e) => setRiskAppetite(e.target.value as NavigatorRiskAppetite)}
                className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
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
          </div>

          {error ? <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setSector(props.sector);
                setRiskAppetite(props.riskAppetite);
              }}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/20 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white/90 dark:hover:bg-black/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="ml-auto rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:opacity-95 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
