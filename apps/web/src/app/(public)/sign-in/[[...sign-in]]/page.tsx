export const runtime = "edge";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-8 py-12">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 shadow-2xl shadow-black/10 dark:shadow-black/40">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Access your dashboard, saved views, and Navigator.
        </p>
        <div className="mt-6">
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
        </div>
      </div>
    </div>
  );
}
