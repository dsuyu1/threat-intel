"use client";

/**
 * Faithful React port of Mouseee by Pedro Isac
 * https://github.com/sspedroisac/mouseee
 *
 * - Outer ring  : 20px circle, 1px solid white border
 * - Inner dot   : 8px (size × 0.4) filled white, centred in ring
 * - Trail       : small dots that vanish after 300 ms
 * - Click       : ring scales to 1.3× on mousedown, back on mouseup
 */

import { useEffect, useRef } from "react";

const BASE_SIZE   = 20;
const TRAIL_TIME  = 300;   // ms before a trail dot is removed
const COLOR       = "#fff";

export function DotCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const sizeRef   = useRef(BASE_SIZE);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    // ── Move ──
    const onMove = (e: MouseEvent) => {
      const s = sizeRef.current;
      cursor.style.transition = "none";
      cursor.style.display    = "flex";
      cursor.style.top        = `${e.pageY - s / 2}px`;
      cursor.style.left       = `${e.pageX - s / 2}px`;

      // Trail dot
      const dot = document.createElement("div");
      const ds  = BASE_SIZE * 0.4;
      dot.style.cssText = `
        position:absolute;
        width:${ds}px;height:${ds}px;
        top:${e.pageY - ds / 2}px;
        left:${e.pageX - ds / 2}px;
        border-radius:50%;
        background:${COLOR};
        pointer-events:none;
        z-index:9998;
        opacity:0.5;
        transition:opacity ${TRAIL_TIME}ms linear;
      `;
      document.body.appendChild(dot);
      // Kick off fade
      requestAnimationFrame(() => { dot.style.opacity = "0"; });
      setTimeout(() => { document.body.removeChild(dot); }, TRAIL_TIME);
    };

    // ── Click animation ──
    const onDown = (e: MouseEvent) => {
      sizeRef.current = BASE_SIZE * 1.3;
      const s = sizeRef.current;
      cursor.style.transition = "all 0.1s ease-in";
      cursor.style.width  = `${s}px`;
      cursor.style.height = `${s}px`;
      cursor.style.top    = `${e.pageY - s / 2}px`;
      cursor.style.left   = `${e.pageX - s / 2}px`;
    };

    const onUp = (e: MouseEvent) => {
      sizeRef.current = BASE_SIZE;
      const s = BASE_SIZE;
      cursor.style.transition = "all 0.1s ease-in";
      cursor.style.width  = `${s}px`;
      cursor.style.height = `${s}px`;
      cursor.style.top    = `${e.pageY - s / 2}px`;
      cursor.style.left   = `${e.pageX - s / 2}px`;
    };

    // ── Scroll: hide ──
    const onScroll = () => { cursor.style.display = "none"; };

    window.addEventListener("mousemove",  onMove,    { passive: true });
    window.addEventListener("mousedown",  onDown);
    window.addEventListener("mouseup",    onUp);
    window.addEventListener("scroll",     onScroll,  { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("scroll",    onScroll);
    };
  }, []);

  const dotSize = BASE_SIZE * 0.4;

  return (
    <div
      ref={cursorRef}
      aria-hidden
      style={{
        position:       "absolute",
        width:          BASE_SIZE,
        height:         BASE_SIZE,
        border:         `1px solid ${COLOR}`,
        borderRadius:   "50%",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        pointerEvents:  "none",
        zIndex:         9999,
      }}
    >
      {/* Inner dot */}
      <div style={{
        width:           dotSize,
        height:          dotSize,
        borderRadius:    "50%",
        backgroundColor: COLOR,
        flexShrink:      0,
      }} />
    </div>
  );
}
