import { OrbitLoader } from "../components/OrbitLoader";

export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-white/70 dark:bg-black/45 backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4">
        <OrbitLoader size={58} color="#a1a1aa" />
        <div className="text-xs tracking-wide text-zinc-700/80 dark:text-zinc-200/80">Loading...</div>
      </div>
    </div>
  );
}

