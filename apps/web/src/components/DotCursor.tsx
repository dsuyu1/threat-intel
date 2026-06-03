"use client";

import { useEffect, useRef } from "react";

const BASE_SIZE = 20;
const COLOR     = "#fff";

export function DotCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const sizeRef   = useRef(BASE_SIZE);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const onMove = (e: MouseEvent) => {
      const s = sizeRef.current;
      cursor.style.transition = "none";
      cursor.style.display    = "flex";
      cursor.style.top        = `${e.pageY - s / 2}px`;
      cursor.style.left       = `${e.pageX - s / 2}px`;


    };

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
      cursor.style.transition = "all 0.1s ease-in";
      cursor.style.width  = `${BASE_SIZE}px`;
      cursor.style.height = `${BASE_SIZE}px`;
      cursor.style.top    = `${e.pageY - BASE_SIZE / 2}px`;
      cursor.style.left   = `${e.pageX - BASE_SIZE / 2}px`;
    };

    const onScroll = () => { cursor.style.display = "none"; };

    window.addEventListener("mousemove", onMove,   { passive: true });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("scroll",    onScroll, { passive: true });

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
