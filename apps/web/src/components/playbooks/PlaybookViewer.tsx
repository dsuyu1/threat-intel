"use client";

import { useMemo, useState } from "react";
import type { PlaybookContentV1, PlaybookPhase, PlaybookToolAction } from "../../lib/playbooks/types";

type TabId = "analyst" | "executive" | "timeline" | "post";

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function sumMinutes(phases: PlaybookPhase[]) {
  let total = 0;
  for (const p of phases) {
    total += Number(p.estimatedMinutes ?? 0);
    for (const s of p.steps) total += Number(s.estimatedMinutes ?? 0);
  }
  return total;
}

async function copy(text: string) {
  const s = String(text ?? "");
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
}

function ToolBadge(props: { tool: PlaybookToolAction["tool"] }) {
  const c = (() => {
    if (props.tool === "splunk") return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20";
    if (props.tool === "jira") return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20";
    if (props.tool === "slack") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
    if (props.tool === "discord") return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20";
    if (props.tool === "soar") return "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/20";
    return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/20";
  })();
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", c)}>
      {props.tool}
    </span>
  );
}

function StepAction(props: { action: PlaybookToolAction }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copy(props.action.content);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ToolBadge tool={props.action.tool} />
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{props.action.label}</div>
        </div>
        <div className="flex items-center gap-2">
          {props.action.href ? (
            <a
              href={props.action.href}
              className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Open →
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void onCopy()}
            className="h-7 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-300 font-mono">
        {props.action.content}
      </pre>
    </div>
  );
}

function PhaseSection(props: { phase: PlaybookPhase }) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            {props.phase.title}
          </h3>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{props.phase.description}</p>
        </div>
        {typeof props.phase.estimatedMinutes === "number" ? (
          <div className="text-xs text-zinc-500 tabular-nums">{props.phase.estimatedMinutes}m</div>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {props.phase.steps.map((s) => (
          <div key={s.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{s.description}</div>
                <div className="mt-2 text-xs text-zinc-500">
                  Owner: <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.ownerRole}</span>
                  {typeof s.estimatedMinutes === "number" ? (
                    <span className="ml-2 tabular-nums">{s.estimatedMinutes}m</span>
                  ) : null}
                </div>
              </div>
            </div>

            {s.toolActions?.length ? (
              <div className="mt-3 space-y-2">
                {s.toolActions.map((a, idx) => (
                  <StepAction key={`${s.id}:${idx}:${a.tool}:${a.label}`} action={a} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PlaybookViewer(props: { content: PlaybookContentV1 }) {
  const [tab, setTab] = useState<TabId>("analyst");

  const totalMinutes = useMemo(() => sumMinutes(props.content.phases), [props.content.phases]);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "analyst", label: "Analyst" },
    { id: "executive", label: "Executive" },
    { id: "timeline", label: "Timeline" },
    { id: "post", label: "Post-incident" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                "h-9 rounded-lg px-3 text-sm transition-colors",
                tab === t.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-zinc-500 tabular-nums">
          Estimated effort: {Math.max(0, Math.round(totalMinutes))}m
        </div>
      </div>

      {tab === "executive" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Summary</h3>
          <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
            {props.content.executiveSummary}
          </pre>
        </section>
      ) : null}

      {tab === "timeline" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">Timeline</h3>
          <div className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {props.content.phases.map((p) => {
              const mins =
                Number(p.estimatedMinutes ?? 0) +
                p.steps.reduce((acc, s) => acc + Number(s.estimatedMinutes ?? 0), 0);
              return (
                <div key={p.id} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2">
                  <div className="font-medium">{p.title}</div>
                  <div className="tabular-nums text-zinc-500">{Math.max(0, Math.round(mins))}m</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-zinc-500">
            Estimates are rough and should be adjusted during review.
          </div>
        </section>
      ) : null}

      {tab === "post" ? (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-5">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            Post-incident
          </h3>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            This view will auto-fill after closure (actual timings, modified steps, and lessons learned).
          </p>
        </section>
      ) : null}

      {tab === "analyst" ? (
        <div className="space-y-4">
          {props.content.phases.map((p) => (
            <PhaseSection key={p.id} phase={p} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

