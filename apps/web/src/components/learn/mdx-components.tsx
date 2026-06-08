import Link from "next/link";
import { Callout } from "./Callout";

function normalizeBaseHref(baseHref: string | undefined) {
  const raw = String(baseHref ?? "/learn").trim() || "/learn";
  return raw.replace(/\/+$/, "") || "/learn";
}

function mapLearnHrefToBase(href: string, baseHref: string) {
  if (!href.startsWith("/learn")) return href;
  const suffix = href.slice("/learn".length);
  return `${baseHref}${suffix}`;
}

export function getLearnMdxComponents(opts?: { baseHref?: string }) {
  const base = normalizeBaseHref(opts?.baseHref);

  function MdxLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const href = String(props.href ?? "");
    const className = `learn-link ${props.className ?? ""}`.trim();

    if (href.startsWith("/")) {
      const rewritten = mapLearnHrefToBase(href, base);
      return (
        <Link href={rewritten} className={className}>
          {props.children}
        </Link>
      );
    }

    const isHash = href.startsWith("#");
    if (isHash) {
      return (
        <a {...props} className={className}>
          {props.children}
        </a>
      );
    }

    return (
      <a {...props} className={className} target={props.target ?? "_blank"} rel={props.rel ?? "noreferrer"}>
        {props.children}
      </a>
    );
  }

  return {
    a: MdxLink,
    Callout,
  };
}

export const learnMdxComponents = getLearnMdxComponents();
