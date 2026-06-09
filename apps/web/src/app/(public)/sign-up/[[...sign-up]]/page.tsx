export const runtime = "edge";

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-8 py-12">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-6 shadow-2xl shadow-black/10 dark:shadow-black/40">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Create account
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Start tracking findings, sources, and your threat posture.
        </p>
        <div className="mt-6">
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
        </div>
      </div>
    </div>
  );
}
