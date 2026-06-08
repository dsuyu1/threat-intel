import clsx from "clsx";
import { Card } from "../ui/Card";

function fmtPct(value: number) {
  const n = Math.round(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

export function KpiCard(props: {
  label: string;
  value: string;
  changePct?: number | null;
  hint?: string;
  href?: string;
}) {
  const change = props.changePct;
  const hasChange = typeof change === "number" && Number.isFinite(change);
  const up = hasChange ? change >= 0 : false;
  const clickable = Boolean(props.href);

  const inner = (
    <Card
      className={clsx(
        "shadow-sm dark:shadow-black/30 bg-white/70 dark:bg-black/30",
        clickable
          ? "transition-colors group-hover:bg-white/90 dark:group-hover:bg-black/40 group-hover:border-zinc-300 dark:group-hover:border-zinc-700"
          : null
      )}
    >
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
              {props.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {props.value}
            </div>
            {props.hint ? (
              <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">{props.hint}</div>
            ) : null}
          </div>

          {hasChange ? (
            <div
              className={clsx(
                "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium tabular-nums",
                up
                  ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/12 text-rose-700 dark:text-rose-300"
              )}
            >
              <span aria-hidden="true">{up ? "↑" : "↓"}</span>
              {fmtPct(change)}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );

  if (!props.href) return inner;

  return (
    <a
      href={props.href}
      className="group block rounded-2xl focus:outline-none focus:ring-2 focus:ring-zinc-400/60 dark:focus:ring-zinc-500/60"
    >
      {inner}
    </a>
  );
}
