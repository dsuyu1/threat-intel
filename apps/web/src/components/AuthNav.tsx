"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function AuthNav() {
  return (
    <div className="flex items-center gap-2">
      <SignedOut>
        <a
          href="/sign-in"
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30 transition-colors"
        >
          Sign in
        </a>
        <a
          href="/sign-up"
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm font-medium hover:opacity-95 transition-opacity"
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
