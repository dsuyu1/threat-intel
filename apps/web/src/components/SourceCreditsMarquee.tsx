"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader } from "./ui/Card";

type SourceCredit = {
  name: string;
  href: string;
  logoSrc: string;
};

const SOURCES: SourceCredit[] = [
  { name: "CISA", href: "https://www.cisa.gov/", logoSrc: "/source-logos/cisa.svg" },
  { name: "NVD", href: "https://nvd.nist.gov/", logoSrc: "/source-logos/nvd.svg" },
  { name: "MITRE ATT&CK", href: "https://attack.mitre.org/", logoSrc: "/source-logos/mitre-attck.svg" },
  { name: "Microsoft Security Blog", href: "https://www.microsoft.com/security/blog/", logoSrc: "/source-logos/microsoft.svg" },
  { name: "Google Security Blog", href: "https://blog.google/security/", logoSrc: "/source-logos/google.svg" },
  { name: "Palo Alto Unit 42", href: "https://unit42.paloaltonetworks.com/", logoSrc: "/source-logos/unit42.svg" },
  { name: "Palo Alto Networks", href: "https://www.paloaltonetworks.com/", logoSrc: "/source-logos/paloaltonetworks.svg" },
  { name: "CrowdStrike", href: "https://www.crowdstrike.com/blog/", logoSrc: "/source-logos/crowdstrike.svg" },
  { name: "Cisco Talos", href: "https://blog.talosintelligence.com/", logoSrc: "/source-logos/cisco-talos.svg" },
  { name: "Cisco", href: "https://www.cisco.com/", logoSrc: "/source-logos/cisco.svg" },
  { name: "SentinelLabs", href: "https://www.sentinelone.com/labs/", logoSrc: "/source-logos/sentinelone.svg" },
  { name: "Rapid7", href: "https://www.rapid7.com/blog/tag/threat-intel/", logoSrc: "/source-logos/rapid7.svg" },
  { name: "ESET WeLiveSecurity", href: "https://www.welivesecurity.com/", logoSrc: "/source-logos/eset.svg" },
  { name: "GitHub", href: "https://github.com/", logoSrc: "/source-logos/github.svg" },
  { name: "Exploit-DB", href: "https://www.exploit-db.com/", logoSrc: "/source-logos/exploitdb.svg" },
  { name: "MalwareBazaar", href: "https://bazaar.abuse.ch/", logoSrc: "/source-logos/malwarebazaar.svg" },
  { name: "ANY.RUN", href: "https://any.run/", logoSrc: "/source-logos/anyrun.svg" },
  { name: "MISP Galaxy", href: "https://github.com/MISP/misp-galaxy", logoSrc: "/source-logos/misp.svg" },
];

export function SourceCreditsStrip({ dense = true }: { dense?: boolean }) {
  return (
    <div className="overflow-hidden">
      <style>{`
        @keyframes source-credits-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .source-credits-marquee { animation: none !important; transform: none !important; }
        }
      `}</style>
      <div
        className={[
          "flex w-max items-center source-credits-marquee hover:[animation-play-state:paused] motion-safe:animate-[source-credits-marquee_55s_linear_infinite]",
          dense ? "gap-5" : "gap-6",
        ].join(" ")}
      >
        {[...SOURCES, ...SOURCES].map((s, idx) => (
          <a
            key={`${s.name}:${idx}`}
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            aria-hidden={idx >= SOURCES.length ? true : undefined}
            aria-label={s.name}
            className="inline-flex items-center justify-center h-8"
          >
            <Image
              src={s.logoSrc}
              alt=""
              width={120}
              height={28}
              className="h-7 w-auto opacity-80 hover:opacity-100 transition-opacity dark:invert"
              loading="lazy"
              unoptimized
            />
          </a>
        ))}
      </div>
    </div>
  );
}

export function SourceCreditsMarquee({
  title = "Sources",
  description = "Live feeds powering ingestion (RSS + STIX).",
  right,
  showTrademarkNote = true,
  dense = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  showTrademarkNote?: boolean;
  dense?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        description={description}
        dense={dense}
        border={false}
        right={
          <div className="flex items-center gap-3">
            {showTrademarkNote ? (
              <div className="text-[11px] text-zinc-500">
                Logos are trademarks of their owners.
              </div>
            ) : null}
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
        }
      />
      <CardContent dense={dense}>
        <SourceCreditsStrip dense={dense} />
      </CardContent>
    </Card>
  );
}
