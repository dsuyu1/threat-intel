"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { OrbitLoader } from "./OrbitLoader";

function isProbablyInternalHref(href: string) {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("tel:")) return false;
  if (href.startsWith("javascript:")) return false;
  if (href.startsWith("/")) return true;
  if (href.startsWith("http://") || href.startsWith("https://")) return true;
  return false;
}

function sameOriginOrRelative(href: string) {
  if (href.startsWith("/")) return true;
  try {
    const u = new URL(href, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function RouteLoadingOverlay() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = useMemo(() => `${pathname}?${searchParams?.toString() ?? ""}`, [pathname, searchParams]);

  const [isDark, setIsDark] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Hide once the route key changes.
  useEffect(() => {
    setShow(false);
  }, [key]);

  // Show immediately on internal navigation clicks.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const a = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;

      const href = a.getAttribute("href") ?? "";
      if (!isProbablyInternalHref(href)) return;
      if (!sameOriginOrRelative(href)) return;

      // Ignore same-page hash changes.
      if (href.startsWith("#")) return;

      setShow(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Safety timeout in case navigation fails.
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => setShow(false), 8000);
    return () => window.clearTimeout(t);
  }, [show]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
        backdropFilter: "blur(3px)",
      }}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4">
        <OrbitLoader size={58} color={isDark ? "#a1a1aa" : "#52525b"} />
        <div className="text-xs tracking-wide text-zinc-200/80 dark:text-zinc-200/80">
          Loading…
        </div>
      </div>
    </div>
  );
}

