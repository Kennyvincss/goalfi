import type { SuccessRule } from "./success-rule";

export interface FitnessSuggestion {
  id: string;
  scope: "personal" | "group";
  title: string;
  description: string;
  successCriteria: string;
  successRule: SuccessRule;
  fitness: { metric: "steps"; dailyTarget?: number };
  durationDays: number;
  marketQuestion: string;
  /** Opening YES probability suggestion (bps), from how hard the target is vs the user's history. */
  initialPriceBps: number;
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Share of recent days at or above a target: a rough probability for the opening price. */
function hitRate(days: number[], target: number): number {
  if (days.length === 0) return 0.5;
  return days.filter((d) => d >= target).length / days.length;
}
const toBps = (p: number) => Math.round(Math.min(0.9, Math.max(0.1, p)) * 100) * 100;

/**
 * Suggest step challenges from a user's recent daily step counts (most recent last).
 * Personal suggestions are scaled to the user's own average; group suggestions to a community size.
 */
export function suggestStepChallenges(recentDailySteps: number[], community?: { name: string; memberCount: number }): FitnessSuggestion[] {
  const days = recentDailySteps.filter((d) => Number.isFinite(d) && d >= 0);
  const avg = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 6000;
  const daily = Math.max(3000, roundUp(avg * 1.15, 500)); // a little above usual
  const everyDay = Math.max(3000, roundUp(avg * 0.9, 500)); // sustainable daily bar
  const week = roundUp(avg * 7 * 1.1, 5000);
  const out: FitnessSuggestion[] = [
    {
      id: "steps-today", scope: "personal", durationDays: 1,
      title: `Walk ${fmt(daily)} steps today`,
      description: `Beat your recent average of ${fmt(Math.round(avg))} steps a day.`,
      successCriteria: `${fmt(daily)}+ steps recorded today by the connected fitness account.`,
      successRule: { type: "individual_threshold", unit: "steps", threshold: daily, minParticipants: 1 },
      fitness: { metric: "steps" },
      marketQuestion: `Will I walk ${fmt(daily)} steps today?`,
      initialPriceBps: toBps(hitRate(days, daily)),
    },
    {
      id: "steps-every-day-week", scope: "personal", durationDays: 7,
      title: `${fmt(everyDay)} steps every day for a week`,
      description: "Seven days in a row, no days off.",
      successCriteria: `${fmt(everyDay)}+ steps on each of 7 days, recorded by the connected fitness account.`,
      successRule: { type: "daily_completion", requiredDays: 7, minParticipants: 1 },
      fitness: { metric: "steps", dailyTarget: everyDay },
      marketQuestion: `Will I hit ${fmt(everyDay)} steps every day this week?`,
      initialPriceBps: toBps(Math.pow(hitRate(days, everyDay), 7)),
    },
    {
      id: "steps-week-total", scope: "personal", durationDays: 7,
      title: `${fmt(week)} steps this week`,
      description: `About 10% more than your usual week.`,
      successCriteria: `${fmt(week)}+ steps in total over 7 days, recorded by the connected fitness account.`,
      successRule: { type: "individual_threshold", unit: "steps", threshold: week, minParticipants: 1 },
      fitness: { metric: "steps" },
      marketQuestion: `Will I walk ${fmt(week)} steps this week?`,
      initialPriceBps: 4000,
    },
  ];
  if (community && community.memberCount >= 2) {
    const n = Math.min(10, Math.max(2, Math.ceil(community.memberCount * 0.5)));
    const groupTotal = roundUp(community.memberCount * 7000 * 7, 50_000);
    out.push(
      {
        id: "group-10k-today", scope: "group", durationDays: 1,
        title: `${n} members walk 10,000 steps today`,
        description: `Can ${n} people in ${community.name} each hit 10,000 steps today?`,
        successCriteria: `At least ${n} participants record 10,000+ steps today on their connected fitness accounts.`,
        successRule: { type: "individual_threshold", unit: "steps", threshold: 10_000, minParticipants: n },
        fitness: { metric: "steps" },
        marketQuestion: `Will ${n} members of ${community.name} walk 10,000 steps today?`,
        initialPriceBps: 5000,
      },
      {
        id: "group-week-total", scope: "group", durationDays: 7,
        title: `${community.name} walks ${fmt(groupTotal)} steps this week`,
        description: "Every participant's steps count toward one group total.",
        successCriteria: `${fmt(groupTotal)}+ steps in total across all participants over 7 days.`,
        successRule: { type: "collective_total", unit: "steps", target: groupTotal },
        fitness: { metric: "steps" },
        marketQuestion: `Will ${community.name} walk ${fmt(groupTotal)} steps this week?`,
        initialPriceBps: 5000,
      },
    );
  }
  return out;
}

/**
 * Fitness apps report totals per *local* calendar day ("2026-11-23"), while a challenge runs between
 * two instants. A day counts when its midday (UTC) falls inside [start, end). For a challenge that
 * spans whole local days, that picks exactly those days for any timezone within ±12h of UTC.
 */
export function civilDayInWindow(dateIso: string, start: Date, end: Date): boolean {
  const noon = new Date(`${dateIso}T12:00:00Z`).getTime();
  return noon >= start.getTime() && noon < end.getTime();
}
