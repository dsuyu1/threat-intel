function stripPort(host: string) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function SecurityLanding({ host }: { host?: string | null }) {
  const normalizedHost = stripPort(String(host ?? ""));
  const displayHost = normalizedHost && normalizedHost !== "localhost" ? normalizedHost : "security.damianvillarreal.com";

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[520px] w-[780px] -translate-x-1/2 rounded-full bg-sky-500/10 dark:bg-sky-400/10 blur-3xl" />
        <div className="absolute -bottom-56 left-1/2 h-[520px] w-[780px] -translate-x-1/2 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 blur-3xl" />
        <div className="absolute inset-0 [background:radial-gradient(circle_at_center,rgba(255,255,255,0.65),rgba(255,255,255,0)_52%)] dark:[background:radial-gradient(circle_at_center,rgba(14,165,233,0.12),rgba(0,0,0,0)_55%)]" />
      </div>

      <header className="relative mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-6 py-6">
        <a href="https://damianvillarreal.com" className="flex items-center gap-3">
          <img src="/cti-logo.svg" alt="" className="h-9 w-9" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Threat Intel</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{displayHost}</div>
          </div>
        </a>

        <div className="flex items-center gap-2">
          <a
            href="/app"
            className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-2 text-sm font-medium hover:opacity-95"
          >
            Dashboard
          </a>
          <a
            href="/sign-up"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
          >
            Request access
          </a>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1200px] px-6 pb-24 pt-10">
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-200">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500/80" />
              Intelligence -&gt; detections -&gt; validation
            </div>

            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl">
              Enter the new age of threat intelligence
            </h1>

            <p className="max-w-[52ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              A modern CTI platform that maps adversary TTPs to your environment, generates detection content, and helps
              you validate and deploy it into your SOC stack.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/app"
                className="inline-flex items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-95"
              >
                Go to dashboard
              </a>
              <a
                href="/connections"
                className="inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-white/80 dark:hover:bg-black/30"
              >
                View integrations
              </a>
            </div>

            <div className="grid max-w-[520px] grid-cols-3 gap-3 pt-2 text-xs text-zinc-500 dark:text-zinc-400">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-2">
                Actor-driven
                <div className="mt-0.5 text-zinc-700 dark:text-zinc-200">CTEM</div>
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-2">
                Generated
                <div className="mt-0.5 text-zinc-700 dark:text-zinc-200">Sigma / SPL</div>
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-2">
                Human-in-loop
                <div className="mt-0.5 text-zinc-700 dark:text-zinc-200">Validation</div>
              </div>
            </div>
          </div>

          <div className="relative mx-auto w-[min(420px,84vw)]">
            <div
              aria-hidden
              className="absolute inset-0 rounded-[44px] bg-gradient-to-b from-sky-500/20 via-indigo-500/10 to-transparent blur-3xl motion-safe:animate-[cti-glow_10s_ease-in-out_infinite] motion-reduce:animate-none"
            />
            <div className="relative mx-auto w-full max-w-[420px]">
              <div className="relative motion-safe:animate-[cti-float_7.5s_ease-in-out_infinite] motion-reduce:animate-none">
                <div
                  aria-hidden
                  className="absolute -inset-6 rounded-full bg-black/5 dark:bg-white/5 blur-xl"
                />
                <img
                  src="/cti-logo.svg"
                  alt="AI humanoid holding a globe"
                  className="relative w-full drop-shadow-2xl"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Close the loop
              </div>
              <h2 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                From adversary behavior to deployed detection
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Navigator maps actor TTPs. The next step is automation: TTP -&gt; generated rule -&gt; pushed to your
                SIEM -&gt; validated against your telemetry.
              </p>
            </div>

            <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500/80" />
                Generate detections in Sigma, KQL, and Splunk SPL
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500/80" />
                Deploy to Splunk as saved searches / alerts
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500/80" />
                Validate detections against your stack, then iterate
              </li>
            </ul>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-4">
              <div className="text-xs font-semibold tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                Quick start
              </div>
              <ol className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
                <li>1) Connect your stack (Splunk / Jira / Slack / SOAR)</li>
                <li>2) Open Navigator and pick a technique</li>
                <li>3) Generate SPL and push to Splunk</li>
              </ol>
            </div>
          </div>
        </section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-8 text-xs text-zinc-500 dark:text-zinc-400">
          <div>© {new Date().getFullYear()} threat-intel</div>
          <div className="flex items-center gap-4">
            <a href="https://damianvillarreal.com" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Blog
            </a>
            <a href="https://damianvillarreal.com/about" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              About
            </a>
            <a href="/sign-in" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Sign in
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
