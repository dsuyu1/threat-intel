export const runtime = "edge";

import { UserProfile } from "@clerk/nextjs";
import { TeamsProjectsPanel } from "../../../components/profile/TeamsProjectsPanel";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-[1440px] px-8 py-10">
      <div className="space-y-6">
        <TeamsProjectsPanel />
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur p-3 shadow-2xl shadow-black/10 dark:shadow-black/40">
          <UserProfile routing="path" path="/profile" />
        </div>
      </div>
    </div>
  );
}
