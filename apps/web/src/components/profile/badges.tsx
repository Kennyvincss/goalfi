import type { Badge as BadgeT } from "@goalfi/core";
import { cn } from "@/lib/utils";

const TIER: Record<BadgeT["tier"], string> = {
  bronze: "border-amber-700/30 bg-amber-700/10",
  silver: "border-slate-400/40 bg-slate-400/10",
  gold: "border-yellow-500/50 bg-yellow-500/15",
};

export function BadgeList({ badges }: { badges: BadgeT[] }) {
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Badges">
      {badges.map((b) => (
        <li key={b.id} title={b.description} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", TIER[b.tier])}>
          <span aria-hidden>{b.emoji}</span>{b.label}
        </li>
      ))}
    </ul>
  );
}
