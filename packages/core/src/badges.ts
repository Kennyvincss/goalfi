/**
 * Public track record and badges. Everything is computed from real activity (resolved challenges,
 * streaks, verification decisions), never self-declared.
 */

export interface TrackRecord {
  joined: number;
  completed: number;
  failed: number;
  currentStreak: number;
  longestStreak: number;
  /** Challenges hosted (published, not cancelled) and how many have settled. */
  hosted: number;
  hostedSettled: number;
  hostedYes: number;
  marketsHosted: number;
  /** Verification decisions that matched the final outcome, and approvals overturned on dispute. */
  fairVerifications: number;
  overturned: number;
  /** Times found holding NO on their own challenge. */
  selfBetFlags: number;
  /** Challenges completed with progress verified by a connected app. */
  appVerifiedCompleted: number;
  reputation: number;
}

export interface Badge {
  id: string;
  label: string;
  description: string;
  tier: "bronze" | "silver" | "gold";
  emoji: string;
}

interface BadgeRule extends Badge {
  value: (r: TrackRecord) => number;
  target: number;
}

const RULES: BadgeRule[] = [
  { id: "streak-7", label: "On a roll", emoji: "🔥", tier: "bronze", description: "A 7-in-a-row streak in a recurring challenge", value: (r) => r.longestStreak, target: 7 },
  { id: "streak-30", label: "Unstoppable", emoji: "🔥", tier: "silver", description: "A 30-in-a-row streak", value: (r) => r.longestStreak, target: 30 },
  { id: "streak-100", label: "Legend", emoji: "🔥", tier: "gold", description: "A 100-in-a-row streak", value: (r) => r.longestStreak, target: 100 },
  { id: "finish-1", label: "First finish", emoji: "🏁", tier: "bronze", description: "Completed a challenge", value: (r) => r.completed, target: 1 },
  { id: "finish-10", label: "Finisher", emoji: "🏁", tier: "silver", description: "Completed 10 challenges", value: (r) => r.completed, target: 10 },
  { id: "finish-50", label: "Closer", emoji: "🏆", tier: "gold", description: "Completed 50 challenges", value: (r) => r.completed, target: 50 },
  { id: "watch-1", label: "Proven by data", emoji: "⌚", tier: "bronze", description: "Completed a challenge verified by a connected app", value: (r) => r.appVerifiedCompleted, target: 1 },
  { id: "host-1", label: "Host", emoji: "🎯", tier: "bronze", description: "Hosted a challenge that settled", value: (r) => r.hostedSettled, target: 1 },
  { id: "host-10", label: "Community host", emoji: "🎯", tier: "silver", description: "Hosted 10 challenges that settled", value: (r) => r.hostedSettled, target: 10 },
  { id: "verifier-10", label: "Fair verifier", emoji: "⚖️", tier: "bronze", description: "10 verification decisions that held up", value: (r) => r.fairVerifications, target: 10 },
  { id: "verifier-50", label: "Trusted verifier", emoji: "⚖️", tier: "silver", description: "50 verification decisions that held up", value: (r) => r.fairVerifications, target: 50 },
];

export function earnedBadges(r: TrackRecord): Badge[] {
  return RULES.filter((b) => b.value(r) >= b.target).map(({ value: _v, target: _t, ...b }) => b);
}

/** The closest badges not yet earned, with progress (for "next up" on the dashboard). */
export function nextBadges(r: TrackRecord, n = 3): { badge: Badge; have: number; target: number }[] {
  return RULES.filter((b) => b.value(r) < b.target)
    // One per family (the lowest tier not yet earned), closest first.
    .filter((b, _i, all) => !all.some((o) => o.id.split("-")[0] === b.id.split("-")[0] && o.target < b.target))
    .map(({ value, target, ...badge }) => ({ badge, have: value(r), target }))
    .sort((a, b) => b.have / b.target - a.have / a.target)
    .slice(0, n);
}

/** Share of settled challenges completed, or null with no settled ones. */
export function successRate(r: Pick<TrackRecord, "completed" | "failed">): number | null {
  const settled = r.completed + r.failed;
  return settled ? r.completed / settled : null;
}
