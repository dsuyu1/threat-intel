import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "card rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur shadow-2xl shadow-black/10 dark:shadow-black/40",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  right,
  className,
  dense = false,
  border = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  className?: string;
  dense?: boolean;
  border?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-4",
        border ? "border-b border-zinc-200/70 dark:border-zinc-800/80" : null,
        dense ? "px-4 py-3" : "px-5 py-4",
        className
      )}
    >
      <div className="min-w-0">
        <div
          className={clsx(
            "font-semibold text-zinc-900 dark:text-zinc-100",
            dense ? "text-xs" : "text-sm"
          )}
        >
          {title}
        </div>
        {description ? (
          <div
            className={clsx(
              "text-zinc-600 dark:text-zinc-400",
              dense ? "mt-0.5 text-[11px]" : "mt-1 text-xs"
            )}
          >
            {description}
          </div>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function CardContent({
  children,
  className,
  dense = false,
}: {
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div className={clsx(dense ? "px-4 py-3" : "px-5 py-4", className)}>
      {children}
    </div>
  );
}
