export const runtime = "edge";

import { LearnNav } from "../../../components/learn/LearnNav";
import { LearnToc } from "../../../components/learn/LearnToc";
import { learnNav } from "../../../content/learn/_generated/manifest";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_240px] gap-8">
        <aside className="lg:sticky lg:top-24 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <LearnNav nav={learnNav} />
        </aside>

        <div className="min-w-0">{children}</div>

        <aside className="hidden lg:block lg:sticky lg:top-24 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <LearnToc />
        </aside>
      </div>
    </div>
  );
}

