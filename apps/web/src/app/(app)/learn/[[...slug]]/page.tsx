export const runtime = "edge";
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLearnDoc } from "../../../../content/learn/_generated/manifest";
import { LearnPrevNext } from "../../../../components/learn/LearnPrevNext";
import { getLearnMdxComponents } from "../../../../components/learn/mdx-components";

type Params = { slug?: string[] };

function hrefFromSlug(slug?: string[]) {
  if (!slug || slug.length === 0) return "/learn";
  return `/learn/${slug.join("/")}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const href = hrefFromSlug(p.slug);
  const doc = getLearnDoc(href);
  if (!doc) return { title: "Learn" };

  const title = doc.frontmatter.title ? `${doc.frontmatter.title} | Learn` : "Learn";
  const description = doc.frontmatter.description ?? undefined;
  return { title, description };
}

export default async function LearnDocPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const href = hrefFromSlug(p.slug);
  const doc = getLearnDoc(href);
  if (!doc) notFound();

  const Doc = doc.Component as any;
  const components = getLearnMdxComponents();

  return (
    <div className="min-w-0">
      <article id="learn-article" className="learn-prose">
        <Doc components={components} />
      </article>
      <LearnPrevNext href={href} />
    </div>
  );
}

