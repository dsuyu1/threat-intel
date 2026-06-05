"use client";

import { useEffect, useRef } from "react";

const BASE_SIZE = 20;
const LIGHT_COLOR = "#111827"; // zinc-900
const DARK_COLOR = "#ffffff";

export function DotCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const sizeRef   = useRef(BASE_SIZE);
  const enabledRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const root = document.documentElement;
    const updateColor = () => {
      const isDark = root.classList.contains("dark");
      cursor.style.color = isDark ? DARK_COLOR : LIGHT_COLOR;
    };
    updateColor();

    const setEnabled = (enabled: boolean) => {
      enabledRef.current = enabled;
      cursor.style.display = enabled ? "flex" : "none";
      if (enabled && lastPosRef.current) {
        const s = sizeRef.current;
        cursor.style.top = `${lastPosRef.current.y - s / 2}px`;
        cursor.style.left = `${lastPosRef.current.x - s / 2}px`;
      }
    };

    const onToggle = (e: Event) => {
      const ce = e as CustomEvent<{ enabled?: boolean }>;
      const enabled = Boolean(ce.detail?.enabled);
      (window as any).__tiDotCursorEnabled = enabled;
      setEnabled(enabled);
    };

    const onMove = (e: MouseEvent) => {
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      if (!enabledRef.current) return;
      const s = sizeRef.current;
      cursor.style.transition = "none";
      cursor.style.top        = `${e.clientY - s / 2}px`;
      cursor.style.left       = `${e.clientX - s / 2}px`;


    };

    const onDown = (e: MouseEvent) => {
      if (!enabledRef.current) return;
      sizeRef.current = BASE_SIZE * 1.3;
      const s = sizeRef.current;
      cursor.style.transition = "all 0.1s ease-in";
      cursor.style.width  = `${s}px`;
      cursor.style.height = `${s}px`;
      cursor.style.top    = `${e.clientY - s / 2}px`;
      cursor.style.left   = `${e.clientX - s / 2}px`;
    };

    const onUp = (e: MouseEvent) => {
      if (!enabledRef.current) return;
      sizeRef.current = BASE_SIZE;
      cursor.style.transition = "all 0.1s ease-in";
      cursor.style.width  = `${BASE_SIZE}px`;
      cursor.style.height = `${BASE_SIZE}px`;
      cursor.style.top    = `${e.clientY - BASE_SIZE / 2}px`;
      cursor.style.left   = `${e.clientX - BASE_SIZE / 2}px`;
    };

    const mo = new MutationObserver(() => updateColor());
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });

    // Default: disabled everywhere until a globe enables it.
    // Also handle the case where the globe enabled it before this effect mounted.
    setEnabled(Boolean((window as any).__tiDotCursorEnabled));

    window.addEventListener("mousemove", onMove,   { passive: true });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("ti-dotcursor", onToggle as EventListener);

    return () => {
      mo.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("ti-dotcursor", onToggle as EventListener);
    };
  }, []);

  const dotSize = BASE_SIZE * 0.4;

  return (
    <div
      ref={cursorRef}
      aria-hidden
      style={{
        position:       "fixed",
        width:          BASE_SIZE,
        height:         BASE_SIZE,
        border:         "1px solid currentColor",
        borderRadius:   "50%",
        display:        "none",
        alignItems:     "center",
        justifyContent: "center",
        pointerEvents:  "none",
        zIndex:         9999,
      }}
    >
      <div style={{
        width:           dotSize,
        height:          dotSize,
        borderRadius:    "50%",
        backgroundColor: "currentColor",
        flexShrink:      0,
      }} />
    </div>
  );
}
