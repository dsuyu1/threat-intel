"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type TocItem = { id: string; text: string; level: 2 | 3 };

function collectHeadings() {
  const root = document.getElementById("learn-article");
  if (!root) return [];
  const els = Array.from(root.querySelectorAll("h2, h3")) as Array<HTMLHeadingElement>;
  return els
    .map((el) => ({
      id: el.id,
      text: (el.textContent ?? "").trim(),
      level: el.tagName.toLowerCase() === "h3" ? (3 as const) : (2 as const),
    }))
    .filter((h) => Boolean(h.id) && Boolean(h.text));
}

export function LearnToc() {
  const pathname = usePathname();
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setItems(collectHeadings());
    setActiveId(null);
  }, [pathname]);

  useEffect(() => {
    if (!items.length) return;
    const root = document.getElementById("learn-article");
    if (!root) return;

    const els = items
      .map((i) => document.getElementById(i.id))
      .filter(Boolean) as HTMLElement[];

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top ?? 0) - (b.boundingClientRect.top ?? 0))[0];
        if (!visible) return;
        const id = visible.target.getAttribute("id");
        if (id) setActiveId(id);
      },
      { root: null, rootMargin: "0px 0px -70% 0px", threshold: [0, 1] },
    );

    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [items]);

  const rendered = useMemo(() => {
    if (!items.length) return null;
    return (
      <nav aria-label="On this page" className="space-y-2">
        <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500">On this page</div>
        <ul className="space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.id} className={i.level === 3 ? "pl-3" : ""}>
              <a
                href={`#${i.id}`}
                className={`block rounded-md px-2 py-1 transition-colors ${
                  activeId === i.id
                    ? "text-zinc-900 dark:text-zinc-100 bg-black/5 dark:bg-white/5"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {i.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }, [activeId, items]);

  return rendered;
}

