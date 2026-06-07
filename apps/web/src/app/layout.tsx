export const runtime = "edge";

import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { DotCursor } from "../components/DotCursor";
import { RouteLoadingOverlay } from "../components/RouteLoadingOverlay";
import { AuthNav } from "../components/AuthNav";
import { AppSidebar } from "../components/AppSidebar";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { ThemeToggle } from "../components/ThemeToggle";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Platform | Damian Villarreal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} h-full dark`} suppressHydrationWarning>
      <body
        className="h-full flex flex-col overflow-hidden bg-white text-zinc-900 dark:bg-[#141414] dark:text-zinc-200 antialiased tracking-tight"
      >
        <ClerkProvider>
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
          <nav className="sticky top-0 shrink-0 z-50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
            <div className="mx-auto max-w-[1440px] px-8 py-4">
              <Nav />
            </div>
          </nav>
          <div className="flex-1 min-h-0 flex">
            <aside className="hidden lg:block w-64 shrink-0 bg-white/40 dark:bg-zinc-950/30 backdrop-blur-sm">
              <div className="h-full overflow-y-auto px-3 py-4">
                <AppSidebar />
              </div>
            </aside>
            <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
          </div>
          <Suspense fallback={null}>
            <RouteLoadingOverlay />
          </Suspense>
          <DotCursor />
        </ClerkProvider>
      </body>
    </html>
  );
}

function Nav() {
  return (
    <nav className="flex items-center gap-6">
      <a
        href="https://damianvillarreal.com"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        blog
      </a>
      <a
        href="https://damianvillarreal.com/about"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        about
      </a>
      <a
        href="/landing"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        platform
      </a>
      <details className="hidden relative group">
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] inline-flex items-center gap-1">
          security
          <span
            className="text-zinc-500 group-open:rotate-180 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
            aria-hidden="true"
          >
            ▾
          </span>
        </summary>
        <div className="absolute left-0 mt-2 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/20 dark:shadow-black/60 p-1 z-50 block opacity-0 translate-y-1 scale-[0.98] pointer-events-none group-open:opacity-100 group-open:translate-y-0 group-open:scale-100 group-open:pointer-events-auto will-change-[opacity,transform] transition-[opacity,transform] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:transform-none">
          <a
            href="/global"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            global view
          </a>
          <a
            href="/findings"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            findings
          </a>
          <a
            href="/actors"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            threat actor library
          </a>
          <a
            href="/navigator"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            navigator
          </a>
          <a
            href="/agents"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            agents
          </a>
          <a
            href="/data"
            className="block rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            data explorer
          </a>
        </div>
      </details>
      <div className="ml-auto flex items-center gap-3">
        <ProjectSwitcher />
        <ThemeToggle />
        <AuthNav />
      </div>
    </nav>
  );
}

