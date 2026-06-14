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
        "rounded-[var(--ti-radius)] border border-[color:var(--ti-card-border)] bg-[color:var(--ti-card)] backdrop-blur-xl shadow-[var(--ti-shadow-sm)]",
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
        border ? "border-b border-[color:var(--ti-border)]" : null,
        dense ? "px-4 py-3" : "px-5 py-4",
        className
      )}
    >
      <div className="min-w-0">
        <div
          className={clsx(
            "font-semibold text-[color:var(--ti-fg)]",
            dense ? "text-xs" : "text-sm"
          )}
        >
          {title}
        </div>
        {description ? (
          <div
            className={clsx(
              "text-[color:var(--ti-muted)]",
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
