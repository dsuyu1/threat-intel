export const runtime = "edge";

import { LearnNav } from "../../../../../components/learn/LearnNav";
import { LearnToc } from "../../../../../components/learn/LearnToc";
import { learnNav } from "../../../../../content/learn/_generated/manifest";

export default async function ProjectLearnLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectSlug: string }>;
}) {
  const p = await params;
  const baseHref = `/p/${p.projectSlug}/learn`;

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_240px] gap-8">
        <aside className="lg:sticky lg:top-24 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <LearnNav nav={learnNav} baseHref={baseHref} />
        </aside>

        <div className="min-w-0">{children}</div>

        <aside className="hidden lg:block lg:sticky lg:top-24 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <LearnToc />
        </aside>
      </div>
    </div>
  );
}

