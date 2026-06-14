export const runtime = "edge";

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
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
  const publicBeta =
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "1" ||
    (process.env["NAVIGATOR_PUBLIC_BETA"] ?? "").toLowerCase() === "true";
  // NOTE (beta): while NAVIGATOR_PUBLIC_BETA is enabled, don't force sign-in for app routes.
  // Turn this OFF before GA / billing.
  if (process.env.NODE_ENV === "production" && !publicBeta && !signedIn) redirect("/sign-in");

  return (
    <>
      <nav className="no-print sticky top-0 shrink-0 z-50 border-b border-[color:var(--ti-border)] bg-[color:var(--ti-nav-bg)] backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 py-3">
          <Nav signedIn={signedIn} />
        </div>
      </nav>
      <div className="flex-1 min-h-0 flex">
        <aside className="no-print hidden lg:block w-64 shrink-0 border-r border-[color:var(--ti-border)] bg-white/40 dark:bg-zinc-950/30 backdrop-blur-sm">
          <div className="h-full overflow-y-auto px-3 py-4">
            <AppSidebar />
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>

      <footer className="no-print shrink-0 border-t border-[color:var(--ti-border)] bg-[color:var(--ti-nav-bg)] backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 py-4 text-xs text-[color:var(--ti-muted)] flex flex-wrap items-center gap-3">
          <div className="mr-auto">Copyright © 2025 Damian Villarreal. All rights reserved.</div>
          <Link
            href="/learn"
            className="rounded-md px-1.5 py-1 hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
          >
            Learn
          </Link>
          <span aria-hidden="true">•</span>
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

      <Suspense fallback={null}>
        <RouteLoadingOverlay />
      </Suspense>
      <DotCursor />
    </>
  );
}

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="flex items-center gap-3">
      <a
        href="https://damianvillarreal.com/"
        target="_blank"
        rel="noreferrer"
        className="rounded-md px-1.5 py-1 text-sm text-[color:var(--ti-muted)] hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
      >
        blog
      </a>
      <a
        href="https://damianvillarreal.com/about"
        target="_blank"
        rel="noreferrer"
        className="rounded-md px-1.5 py-1 text-sm text-[color:var(--ti-muted)] hover:text-[color:var(--ti-fg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
      >
        about
      </a>
      <div className="ml-auto flex items-center gap-3">
        {signedIn ? <ProjectSwitcher /> : null}
        <ThemeToggle />
        <AuthNav />
      </div>
    </nav>
  );
}
