"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fixText } from "../../lib/text";

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={["text-sm text-zinc-700 dark:text-zinc-400 leading-relaxed", className]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ className: aClassName, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className={[
                "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2",
                aClassName,
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ),
          p: ({ className: pClassName, ...props }) => (
            <p
              {...props}
              className={["mt-2 first:mt-0", pClassName].filter(Boolean).join(" ")}
            />
          ),
          ul: ({ className: ulClassName, ...props }) => (
            <ul
              {...props}
              className={["mt-2 first:mt-0 list-disc pl-5 space-y-1", ulClassName]
                .filter(Boolean)
                .join(" ")}
            />
          ),
          ol: ({ className: olClassName, ...props }) => (
            <ol
              {...props}
              className={["mt-2 first:mt-0 list-decimal pl-5 space-y-1", olClassName]
                .filter(Boolean)
                .join(" ")}
            />
          ),
          li: ({ className: liClassName, ...props }) => (
            <li
              {...props}
              className={["leading-relaxed", liClassName].filter(Boolean).join(" ")}
            />
          ),
          code: ({ className: codeClassName, ...props }) => (
            <code
              {...props}
              className={[
                "rounded bg-zinc-100 dark:bg-black/40 border border-zinc-200 dark:border-zinc-800 px-1 py-0.5 font-mono text-[0.95em] text-zinc-900 dark:text-zinc-200",
                codeClassName,
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ),
        }}
      >
        {fixText(children)}
      </ReactMarkdown>
    </div>
  );
}
