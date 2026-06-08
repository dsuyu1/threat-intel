export const runtime = "edge";

import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DotCursor } from "../../components/DotCursor";
import { RouteLoadingOverlay } from "../../components/RouteLoadingOverlay";
import { AuthNav } from "../../components/AuthNav";
import { AppSidebar } from "../../components/AppSidebar";
import { ProjectSwitcher } from "../../components/ProjectSwitcher";
import { ThemeToggle } from "../../components/ThemeToggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const a = await auth().catch(() => null);
  const signedIn = Boolean(a?.userId);

  return (
    <>
      <nav className="no-print sticky top-0 shrink-0 z-50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-[1440px] px-8 py-4">
          <Nav signedIn={signedIn} />
        </div>
      </nav>
      <div className="flex-1 min-h-0 flex">
        <aside className="no-print hidden lg:block w-64 shrink-0 bg-white/40 dark:bg-zinc-950/30 backdrop-blur-sm">
          <div className="h-full overflow-y-auto px-3 py-4">
            <AppSidebar />
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>

      <footer className="no-print shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/40 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-8 py-4 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-3">
          <div className="mr-auto">Copyright © 2025 Damian Villarreal. All rights reserved.</div>
          <Link href="/learn" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Learn
          </Link>
          <span aria-hidden="true">•</span>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Terms
          </Link>
          <span aria-hidden="true">•</span>
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Privacy
          </Link>
        </div>
      </footer>

      <Suspense fallback={null}>
        <RouteLoadingOverlay />
      </Suspense>
      <DotCursor />
    </>
  );
}

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="flex items-center gap-6">
      <a
        href="https://damianvillarreal.com"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
        target="_blank"
        rel="noreferrer"
      >
        blog
      </a>
      <a
        href="https://damianvillarreal.com/about"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
        target="_blank"
        rel="noreferrer"
      >
        about
      </a>
      <Link
        href="/terms"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        terms
      </Link>
      <Link
        href="/privacy"
        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        privacy
      </Link>
      <div className="ml-auto flex items-center gap-3">
        {signedIn ? <ProjectSwitcher /> : null}
        <ThemeToggle />
        <AuthNav />
      </div>
    </nav>
  );
}
