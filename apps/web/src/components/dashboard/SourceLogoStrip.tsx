import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "../ui/Card";

type SourceRow = {
  id: string;
  name: string;
  url: string;
  type: string;
  enabled: boolean;
};

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function safeExternalHref(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function faviconUrl(hostname: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

export function SourceLogoStrip({
  sources,
  description = "Live feeds powering ingestion (RSS + STIX).",
  right,
}: {
  sources: SourceRow[];
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title="Sources"
        description={description}
        right={
          right ?? (
            <a
              href="/data/sources"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              View table
            </a>
          )
        }
      />
      <CardContent>
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1">
          {sources.map((s) => {
            const hostname = hostnameFromUrl(s.url);
            const href = safeExternalHref(s.url);

            const content = (
              <>
                <div className="relative h-6 w-6 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-200 dark:border-zinc-800">
                  {hostname ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={faviconUrl(hostname)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                    {s.name}
                  </div>
                  {!s.enabled ? (
                    <span className="text-[10px] rounded-full border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-zinc-600 dark:text-zinc-400">
                      disabled
                    </span>
                  ) : null}
                </div>
              </>
            );

            const className =
              "shrink-0 group flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 px-3 py-2 transition-colors";
            const title = `${s.name} • ${s.type}${s.enabled ? "" : " (disabled)"}`;

            return href ? (
              <a
                key={s.id}
                className={`${className} hover:bg-white/70 dark:hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}
                title={title}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {content}
              </a>
            ) : (
              <div key={s.id} className={className} title={title}>
                {content}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
