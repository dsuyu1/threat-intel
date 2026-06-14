"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function AuthNav() {
  return (
    <div className="flex items-center gap-2">
      <SignedOut>
        <a
          href="/sign-in"
          className="inline-flex h-9 items-center rounded-lg border border-[color:var(--ti-border)] bg-[color:var(--ti-card)] px-3 text-sm text-[color:var(--ti-fg)] hover:bg-white/85 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
        >
          Sign in
        </a>
        <a
          href="/sign-up"
          className="inline-flex h-9 items-center rounded-lg bg-[color:var(--color-brand)] px-3 text-sm font-semibold text-[color:var(--color-brand-fg)] shadow-sm shadow-black/10 hover:brightness-[1.02] active:brightness-[0.98] transition-[filter] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
        >
          Sign up
        </a>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/profile" />
      </SignedIn>
    </div>
  );
}
