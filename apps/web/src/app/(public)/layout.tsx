export const runtime = "edge";

import Link from "next/link";
import { AuthNav } from "../../components/AuthNav";
import { ThemeToggle } from "../../components/ThemeToggle";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="no-print sticky top-0 shrink-0 z-50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-[1440px] px-8 py-4 flex items-center gap-6">
          <Link
            href="/learn"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:opacity-90 transition-opacity"
          >
            Threat Intel
          </Link>

          <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/learn" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              Learn
            </Link>
            <Link href="/app" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              App
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <AuthNav />
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      <footer className="no-print shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/40 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-8 py-4 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-3">
          <div className="mr-auto">Copyright © 2025 Damian Villarreal. All rights reserved.</div>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Terms
          </Link>
          <span aria-hidden="true">•</span>
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Privacy
          </Link>
        </div>
      </footer>
    </>
  );
}
