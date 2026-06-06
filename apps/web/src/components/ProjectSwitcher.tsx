"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Project = { id: string; teamId: string; slug: string; name: string };

type ApiResponse =
  | { ok: true; team: { id: string; name: string }; project: Project; projects: Project[] }
  | { error: string };

function parseProjectSlug(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "p") return null;
  return parts[1] ?? null;
}

function safeErrorMessage(err: unknown) {
  const anyErr = err as any;
  return String(anyErr?.message ?? err ?? "Unknown error");
}

export function ProjectSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  const pathProjectSlug = useMemo(() => parseProjectSlug(pathname), [pathname]);

  const [data, setData] = useState<{ team: { id: string; name: string }; project: Project; projects: Project[] } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const res = await fetch("/api/projects", {
          headers: pathProjectSlug ? { "x-ti-project-slug": pathProjectSlug } : undefined,
        });
        const json = (await res.json().catch(() => null)) as ApiResponse | null;
        if (cancelled) return;
        if (!res.ok || !json || !("ok" in json) || !json.ok) {
          const msg = json && "error" in json ? json.error : `Failed to load projects (${res.status})`;
          throw new Error(msg);
        }
        setData({ team: json.team, project: json.project, projects: json.projects });
      } catch (e) {
        if (!cancelled) setError(safeErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathProjectSlug]);

  const currentSlug = data?.project.slug ?? pathProjectSlug ?? "";

  const onSelect = async (nextSlug: string) => {
    const slug = String(nextSlug ?? "").trim();
    if (!slug) return;
    if (slug === currentSlug) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/projects/default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectSlug: slug }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(body?.error ?? `Request failed (${res.status})`));

      const qs = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
      const nextPath = (() => {
        if (pathname.startsWith("/p/")) {
          const parts = pathname.split("/");
          // ["", "p", "<slug>", ...]
          if (parts.length >= 3) parts[2] = slug;
          return parts.join("/");
        }
        return `/p/${slug}`;
      })();

      router.push(qs ? `${nextPath}?${qs}` : nextPath);
      router.refresh();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || loading || !data;

  return (
    <div className="hidden sm:flex items-center gap-2">
      <div className="relative">
        <select
          value={currentSlug}
          disabled={disabled}
          onChange={(e) => void onSelect(e.target.value)}
          className="h-9 appearance-none rounded-lg border border-transparent bg-transparent px-3 pr-8 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-60"
          aria-label="Select project"
        >
          {data?.projects?.length ? (
            data.projects.map((p) => (
              <option key={p.id} value={p.slug}>
                Project {p.name}
              </option>
            ))
          ) : (
            <option value={currentSlug || "default"}>Project {currentSlug || "Default"}</option>
          )}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {error ? <div className="ml-2 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}
    </div>
  );
}
