import type { ReactNode } from "react";
import { AlertTriangle, Info, Lightbulb, Sparkles } from "lucide-react";
import { ProBadge } from "./ProBadge";

type CalloutType = "note" | "warning" | "tip" | "pro";

const meta: Record<
  CalloutType,
  {
    label: string;
    icon: typeof Info;
    className: string;
    iconClassName: string;
  }
> = {
  note: {
    label: "Note",
    icon: Info,
    className: "border-sky-500/25 bg-sky-500/10 text-sky-900 dark:text-sky-100",
    iconClassName: "text-sky-700 dark:text-sky-200",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className: "border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100",
    iconClassName: "text-amber-700 dark:text-amber-200",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
    iconClassName: "text-emerald-700 dark:text-emerald-200",
  },
  pro: {
    label: "Pro",
    icon: Sparkles,
    className: "border-violet-500/25 bg-violet-500/10 text-violet-950 dark:text-violet-100",
    iconClassName: "text-violet-700 dark:text-violet-200",
  },
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const m = meta[type];
  const Icon = m.icon;
  return (
    <div className={`my-6 rounded-2xl border p-4 ${m.className}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${m.iconClassName}`} aria-hidden="true">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold tracking-wide uppercase">{title ?? m.label}</div>
            {type === "pro" ? <ProBadge /> : null}
          </div>
          <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{children}</div>
        </div>
      </div>
    </div>
  );
}

