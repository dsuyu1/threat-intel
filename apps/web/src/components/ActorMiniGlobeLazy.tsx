"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const Globe = dynamic(
  () => import("./ActorMiniGlobe").then((m) => m.ActorMiniGlobe),
  { ssr: false }
);

export function ActorMiniGlobeLazy(props: {
  lat: number;
  lng: number;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden h-64"
    >
      {visible ? (
        <Globe {...props} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500">
          Loading globe…
        </div>
      )}
    </div>
  );
}
