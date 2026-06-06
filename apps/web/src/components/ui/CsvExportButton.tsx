"use client";

import { useMemo } from "react";

type Column<T> = {
  header: string;
  key: string;
};

function csvEscape(value: string) {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function toCsv<T>(rows: T[], columns: Column<T>[]) {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = getByPath(r, c.key);
        let s = "";
        if (v == null) {
          s = "";
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          s = String(v);
        } else {
          try {
            s = JSON.stringify(v);
          } catch {
            s = String(v);
          }
        }
        return csvEscape(s);
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

export function CsvExportButton<T>(props: {
  filename: string;
  rows: T[];
  columns: Column<T>[];
  label?: string;
}) {
  const csv = useMemo(() => toCsv(props.rows ?? [], props.columns ?? []), [props.rows, props.columns]);

  const onClick = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = props.filename || "export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-sm hover:bg-white dark:hover:bg-black/40"
    >
      {props.label ?? "Export CSV"}
    </button>
  );
}
