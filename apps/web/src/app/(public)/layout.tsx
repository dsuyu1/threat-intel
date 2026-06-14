export const runtime = "edge";

import Link from "next/link";
import { AuthNav } from "../../components/AuthNav";
import { ThemeToggle } from "../../components/ThemeToggle";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="no-print sticky top-0 shrink-0 z-50 border-b border-[color:var(--ti-border)] bg-[color:var(--ti-nav-bg)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 py-3 flex items-center gap-6">
          <nav className="flex items-center gap-4 text-sm text-[color:var(--ti-muted)]">
            <a
              href="https://damianvillarreal.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1.5 py-1 hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
            >
              blog
            </a>
            <a
              href="https://damianvillarreal.com/about"
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1.5 py-1 hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
            >
              about
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <AuthNav />
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      <footer className="no-print shrink-0 border-t border-[color:var(--ti-border)] bg-[color:var(--ti-nav-bg)] backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 py-4 text-xs text-[color:var(--ti-muted)] flex flex-wrap items-center gap-3">
          <div className="mr-auto">Copyright © 2025 Damian Villarreal. All rights reserved.</div>
          <Link
            href="/terms"
            className="rounded-md px-1.5 py-1 hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
          >
            Terms
          </Link>
          <span aria-hidden="true">•</span>
          <Link
            href="/privacy"
            className="rounded-md px-1.5 py-1 hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
          >
            Privacy
          </Link>
        </div>
      </footer>
    </>
  );
}
