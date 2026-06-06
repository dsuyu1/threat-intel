export const runtime = "edge";
export const dynamic = "force-dynamic";

import { AgentBuilder } from "../../../components/agents/AgentBuilder";

export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-[900px] px-8 py-10">
      <AgentBuilder />
    </div>
  );
}

