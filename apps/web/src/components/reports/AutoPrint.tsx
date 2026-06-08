"use client";

import { useEffect } from "react";

export function AutoPrint(props: { enabled: boolean }) {
  useEffect(() => {
    if (!props.enabled) return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore
      }
    }, 60);
    return () => clearTimeout(t);
  }, [props.enabled]);

  return null;
}

