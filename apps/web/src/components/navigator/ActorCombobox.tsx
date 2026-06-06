"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ActorOption = { id: string; label: string };

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function ActorCombobox(props: {
  name: string;
  options: ActorOption[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const placeholder = props.placeholder ?? "All";
  const [selectedId, setSelectedId] = useState(props.defaultValue ?? "");

  const selectedLabel = useMemo(() => {
    const id = selectedId.trim();
    if (!id) return "";
    return props.options.find((o) => o.id === id)?.label ?? id;
  }, [props.options, selectedId]);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(selectedLabel);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    setSelectedId(props.defaultValue ?? "");
  }, [props.defaultValue]);

  useEffect(() => {
    setText(selectedLabel);
  }, [selectedLabel]);

  const query = normalize(open ? text : "");

  const filtered = useMemo(() => {
    const maxItems = 60;
    if (!query) return props.options.slice(0, maxItems);
    return props.options
      .filter((o) => {
        const hay = `${o.label} ${o.id}`.toLowerCase();
        return hay.includes(query);
      })
      .slice(0, maxItems);
  }, [props.options, query]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
      setText(selectedLabel);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, selectedLabel]);

  const choose = (id: string) => {
    setSelectedId(id);
    const label = id ? props.options.find((o) => o.id === id)?.label ?? id : "";
    setText(label);
    setOpen(false);
  };

  const onFocus = () => {
    setOpen(true);
    setActiveIdx(0);
    if (text === selectedLabel) setText("");
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      setActiveIdx(0);
      return;
    }

    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setText(selectedLabel);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const next = filtered[activeIdx];
      if (next) choose(next.id);
      else choose("");
    }
  };

  const listId = `${props.name}-actor-combobox-list`;
  const activeId = open && filtered[activeIdx] ? `${listId}-${filtered[activeIdx]!.id}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={props.name} value={selectedId} />

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={text}
          onFocus={onFocus}
          onChange={(e) => {
            setOpen(true);
            setText(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={
            props.className ??
            "w-full min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/40 px-3 py-2 text-sm"
          }
        />
        {selectedId ? (
          <button
            type="button"
            onClick={() => {
              choose("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label="Clear actor filter"
          >
            ×
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-2 w-full min-w-[260px] max-h-[320px] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/10 dark:shadow-black/60 p-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedId === ""}
            onClick={() => choose("")}
            className={[
              "w-full text-left rounded-lg px-3 py-2 text-sm",
              selectedId === ""
                ? "bg-sky-500/10 text-sky-800 dark:text-sky-200"
                : "hover:bg-black/5 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200",
            ].join(" ")}
          >
            All actors
          </button>

          {filtered.length ? (
            <div className="mt-1">
              {filtered.map((o, idx) => {
                const active = idx === activeIdx;
                const selected = o.id === selectedId;
                return (
                  <button
                    key={o.id}
                    id={`${listId}-${o.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => choose(o.id)}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2",
                      active ? "bg-black/5 dark:bg-white/5" : "",
                      selected ? "text-sky-800 dark:text-sky-200" : "text-zinc-700 dark:text-zinc-200",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="text-sm truncate">{o.label}</div>
                    <div className="text-[11px] text-zinc-500 tabular-nums truncate">{o.id}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-sm text-zinc-500">No matches.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
