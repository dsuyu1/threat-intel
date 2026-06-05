export const runtime = "edge";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { DotCursor } from "../components/DotCursor";
import { RouteLoadingOverlay } from "../components/RouteLoadingOverlay";
import { ThemeToggle } from "../components/ThemeToggle";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Security | Damian Villarreal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} h-full dark`} suppressHydrationWarning>
      <body
        className="h-full flex flex-col bg-white text-zinc-900 dark:bg-[#141414] dark:text-zinc-200 antialiased tracking-tight"
      >
        <Script id="theme-init" strategy="beforeInteractive">{`
          (() => {
            try {
              const key = "theme";
              const stored = localStorage.getItem(key);
              const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
              const theme = stored === "light" || stored === "dark" ? stored : (systemDark ? "dark" : "light");
              document.documentElement.classList.toggle("dark", theme === "dark");
              document.documentElement.style.colorScheme = theme;
            } catch {}
          })();
        `}</Script>
        <nav className="shrink-0 z-10 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
          <div className="max-w-[90ch] mx-auto px-8 py-4">
            <Nav />
          </div>
        </nav>
        <main className="flex-1 min-h-0">{children}</main>
        <RouteLoadingOverlay />
        <DotCursor />
      </body>
    </html>
  );
}

function Nav() {
  return (
    <nav className="flex items-center gap-6">
      <a
        href="https://damianvillarreal.com"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      >
        blog
      </a>
      <a
        href="https://damianvillarreal.com/about"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      >
        about
      </a>
      <details className="relative group">
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors inline-flex items-center gap-1">
          security
          <span
            className="text-zinc-500 group-open:rotate-180 transition-transform"
            aria-hidden="true"
          >
            ▾
          </span>
        </summary>
        <div className="absolute left-0 mt-2 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/20 dark:shadow-black/60 p-1 z-50">
          <a
            href="/"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            global view
          </a>
          <a
            href="/actors"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            threat actors
          </a>
        </div>
      </details>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </nav>
  );
}

