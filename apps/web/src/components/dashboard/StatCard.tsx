import { Card } from "../ui/Card";
import clsx from "clsx";

export function StatCard({
  label,
  value,
  hint,
  accent = "sky",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "sky" | "violet" | "emerald" | "orange" | "rose";
  href?: string;
}) {
  const accentClass =
    accent === "violet"
      ? "from-violet-500/15 to-fuchsia-500/5"
      : accent === "emerald"
        ? "from-emerald-500/15 to-lime-500/5"
        : accent === "orange"
          ? "from-orange-500/15 to-amber-500/5"
          : accent === "rose"
            ? "from-rose-500/15 to-pink-500/5"
            : "from-sky-500/15 to-indigo-500/5";

  const inner = (
    <Card className="relative overflow-hidden">
      <div
        className={clsx(
          "pointer-events-none absolute inset-0 bg-gradient-to-br",
          accentClass
        )}
      />
      <div className="relative px-4 py-3">
        <div className="text-[11px] font-medium tracking-wide uppercase text-[color:var(--ti-muted)]">
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold text-[color:var(--ti-fg)] tabular-nums">
          {value}
        </div>
        {hint ? (
          <div className="mt-0.5 text-[11px] text-[color:var(--ti-muted)]">
            {hint}
          </div>
        ) : null}
      </div>
    </Card>
  );

  if (!href) return inner;

  return (
    <a
      href={href}
      className="block rounded-[var(--ti-radius)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
    >
      {inner}
    </a>
  );
}
