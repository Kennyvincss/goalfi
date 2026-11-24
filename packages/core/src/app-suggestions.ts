import { APP_METRICS, describeDailyTarget, formatMetricValue, meetsDailyTarget, type AppMetricDef, type AppMetricId } from "./app-metrics";
import type { SuccessRule } from "./success-rule";

export type Difficulty = "easy" | "medium" | "hard";

export interface AppSuggestion {
  /** `${metric}:${kind}`, stable so the builder can look it up again. */
  id: string;
  metric: AppMetricId;
  scope: "personal" | "group";
  difficulty: Difficulty;
  title: string;
  description: string;
  successCriteria: string;
  successRule: SuccessRule;
  app: { metric: AppMetricId; dailyTarget?: number };
  durationDays: number;
  marketQuestion: string;
  /** Opening YES probability suggestion (bps), from how often similar targets were hit recently. */
  initialPriceBps: number;
}

const VERB: Partial<Record<AppMetricId, string>> = {
  steps: "Walk", distance_km: "Cover", running_km: "Run", floors: "Climb", heart_zone_minutes: "Get", workouts: "Do",
  github_contributions: "Make", lichess_games: "Play", lichess_puzzles: "Solve",
};
const roundUp = (n: number, step: number) => Math.round(Math.ceil(n / step - 1e-9) * step * 100) / 100;
const roundDown = (n: number, step: number) => Math.round(Math.floor(n / step + 1e-9) * step * 100) / 100;
const unitFor = (metric: AppMetricDef, n: number) => (n === 1 && metric.unit.endsWith("s") ? metric.unit.slice(0, -1) : metric.unit);
const amount = (metric: AppMetricDef, n: number) => `${formatMetricValue(metric, n)} ${unitFor(metric, n)}`;
const clamp = (metric: AppMetricDef, n: number) => Math.min(metric.daily.max, Math.max(metric.daily.min, n));
const toBps = (p: number) => Math.round(Math.min(0.9, Math.max(0.1, p)) * 100) * 100;
function hitRate(metric: AppMetricDef, days: number[], target: number): number {
  if (days.length === 0) return 0.5;
  return days.filter((d) => meetsDailyTarget(metric, d, target)).length / days.length;
}
/** P(at least k successes in n days) when each day succeeds with probability p. */
function atLeast(k: number, n: number, p: number): number {
  let total = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    total += c * p ** i * (1 - p) ** (n - i);
  }
  return total;
}
/** Rough odds of hitting a multi-day total, from how far the target is above the usual pace. */
function totalOdds(target: number, usual: number): number {
  const r = usual > 0 ? target / usual : 2;
  return r <= 0.9 ? 0.75 : r <= 1.0 ? 0.6 : r <= 1.1 ? 0.45 : r <= 1.25 ? 0.3 : 0.15;
}
const period = (d: number) => (d === 1 ? "today" : d === 7 ? "this week" : d === 14 ? "in 2 weeks" : d === 30 ? "in 30 days" : `in ${d} days`);

/**
 * Suggest challenges for one metric from the user's recent daily values (oldest first, complete
 * days only): easy / medium / hard versions over several time frames (today, 3 days, a week, two
 * weeks, a month), as totals, daily streaks and "k of n days". Group suggestions are scaled to a
 * community; community-level metrics (member counts) use the community's current value.
 */
export function suggestChallenges(
  metricId: AppMetricId,
  recentDaily: number[],
  community?: { name: string; memberCount: number; currentLevel?: number },
): AppSuggestion[] {
  const metric: AppMetricDef = APP_METRICS[metricId];
  const step = metric.daily.step;
  const out: AppSuggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Omit<AppSuggestion, "metric" | "app"> & { app?: AppSuggestion["app"] }) => {
    // Skip near-duplicates (e.g. easy and medium rounding to the same target).
    const key = `${s.scope}:${s.durationDays}:${JSON.stringify(s.successRule)}:${s.app?.dailyTarget ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ metric: metricId, app: { metric: metricId }, ...s });
  };

  if (metric.source === "level") {
    const now = community?.currentLevel;
    if (!community || now === undefined) return [];
    const to = (pct: number, min: number) => Math.max(now + min, Math.ceil((now * pct) / 5) * 5);
    const plans: [string, number, number, number, Difficulty][] = [
      ["grow-7", 7, to(1.1, 5), 4000, "easy"],
      ["grow-14", 14, to(1.2, 10), 3500, "medium"],
      ["grow-30", 30, to(1.25, 10), 3500, "medium"],
      ["double-30", 30, Math.max(now * 2, now + 20), 1500, "hard"],
    ];
    for (const [kind, days, goal, price, difficulty] of plans)
      add({
        id: `${metricId}:${kind}`, scope: "group", difficulty, durationDays: days,
        title: kind === "double-30" ? `${community.name} doubles to ${formatMetricValue(metric, goal)} ${metric.unit}` : `${community.name} reaches ${formatMetricValue(metric, goal)} ${metric.unit}`,
        description: `From ${formatMetricValue(metric, now)} today to ${formatMetricValue(metric, goal)} within ${days} days.`,
        successCriteria: `${metric.label} is at least ${formatMetricValue(metric, goal)} when the challenge ends, as counted by GoalFi.`,
        successRule: { type: "individual_threshold", unit: metric.unit, threshold: goal, minParticipants: 1 },
        marketQuestion: `Will ${community.name} reach ${formatMetricValue(metric, goal)} ${metric.unit} in ${days} days?`,
        initialPriceBps: price,
      });
    return out;
  }

  const days = recentDaily.filter((d) => Number.isFinite(d) && d >= 0);
  const avg = days.length ? days.reduce((a, b) => a + b, 0) / days.length : metric.daily.typical;
  const histNote = days.length ? `You average ${formatMetricValue(metric, avg)} a day.` : "A starting target. It adapts once your data syncs.";

  if (metric.better === "lower") {
    // Wake-up time: usual time, earlier stretches, longer streaks.
    const t = (x: number) => clamp(metric, x);
    const usual = t(roundUp(avg, step)), early = t(roundDown(avg - 15, step)), stretch = t(roundDown(avg - 30, step));
    const plans: [string, number, number, number, Difficulty][] = [
      ["usual-3", usual, 3, 3, "easy"],
      ["usual-week", usual, 7, 7, "medium"],
      ["stretch-5of7", stretch, 5, 7, "medium"],
      ["early-week", early, 7, 7, "hard"],
      ["usual-10of14", usual, 10, 14, "medium"],
      ["stretch-20of30", stretch, 20, 30, "hard"],
    ];
    for (const [kind, target, req, n, difficulty] of plans) {
      const by = formatMetricValue(metric, target);
      add({
        id: `${metricId}:${kind}`, scope: "personal", difficulty, durationDays: n, app: { metric: metricId, dailyTarget: target },
        title: req === n ? `Wake up by ${by} every day for ${n === 7 ? "a week" : `${n} days`}` : `Wake up by ${by} on ${req} of ${n} days`,
        description: days.length ? `You usually wake around ${formatMetricValue(metric, avg)}.` : "Based on your watch's sleep tracking.",
        successCriteria: `Main sleep ends by ${by} (local time) on ${req} of the ${n} days, recorded by the connected account.`,
        successRule: { type: "daily_completion", requiredDays: req, minParticipants: 1 },
        marketQuestion: req === n ? `Will I wake up by ${by} every day for ${n} days?` : `Will I wake up by ${by} on ${req} of ${n} days?`,
        initialPriceBps: toBps(atLeast(req, n, days.length ? hitRate(metric, days, target) : 0.6)),
      });
    }
    return out;
  }

  const verb = VERB[metricId] ?? "Log";
  const v = verb.toLowerCase();
  const daily = (x: number) => clamp(metric, Math.max(metric.daily.min, roundUp(x, step)));
  const total = (x: number) => Math.max(metric.daily.min * 2, roundUp(x, step));
  const p = (target: number) => (days.length ? hitRate(metric, days, target) : 0.5);

  // One day, three difficulties.
  for (const [kind, mult, difficulty] of [["today-easy", 0.9, "easy"], ["today", 1.15, "medium"], ["today-hard", 1.5, "hard"]] as const) {
    const target = daily(avg * mult);
    add({
      id: `${metricId}:${kind}`, scope: "personal", difficulty, durationDays: 1,
      title: `${verb} ${amount(metric, target)} today`,
      description: kind === "today-easy" ? `A warm-up. ${histNote}` : kind === "today" ? `Beat your usual day. ${histNote}` : `A big day. ${histNote}`,
      successCriteria: `${amount(metric, target)} or more today, recorded by the connected account.`,
      successRule: { type: "individual_threshold", unit: metric.unit, threshold: target, minParticipants: 1 },
      marketQuestion: `Will I ${v} ${amount(metric, target)} today?`,
      initialPriceBps: toBps(p(target)),
    });
  }
  // Totals over several days.
  for (const [kind, n, mult, difficulty] of [["3day-total", 3, 1.1, "medium"], ["week-total", 7, 1.1, "medium"], ["2week-total", 14, 1.2, "hard"], ["month-total", 30, 1.1, "hard"]] as const) {
    const target = total(avg * n * mult);
    add({
      id: `${metricId}:${kind}`, scope: "personal", difficulty, durationDays: n,
      title: `${amount(metric, target)} ${period(n)}`,
      description: `About ${Math.round((mult - 1) * 100)}% more than your usual ${n === 7 ? "week" : `${n} days`}.`,
      successCriteria: `${amount(metric, target)} or more in total over ${n} days, recorded by the connected account.`,
      successRule: { type: "individual_threshold", unit: metric.unit, threshold: target, minParticipants: 1 },
      marketQuestion: `Will I ${v} ${amount(metric, target)} ${period(n)}?`,
      initialPriceBps: toBps(totalOdds(target, avg * n)),
    });
  }
  // Streaks and "k of n days".
  const plans: [string, number, number, number, Difficulty][] = [
    ["every-day-3", avg * 0.9, 3, 3, "easy"],
    ["every-day-week", avg * 0.9, 7, 7, "hard"],
    ["5-of-7", avg, 5, 7, "medium"],
    ["10-of-14", avg, 10, 14, "medium"],
    ["every-day-14", avg * 0.8, 14, 14, "hard"],
    ["20-of-30", avg, 20, 30, "hard"],
  ];
  for (const [kind, x, req, n, difficulty] of plans) {
    const target = daily(x);
    add({
      id: `${metricId}:${kind}`, scope: "personal", difficulty, durationDays: n, app: { metric: metricId, dailyTarget: target },
      title: req === n ? `${amount(metric, target)} every day for ${n === 7 ? "a week" : `${n} days`}` : `${amount(metric, target)} on ${req} of ${n} days`,
      description: req === n ? `${n} days in a row, no days off.` : `Consistency with room for ${n - req} off day${n - req === 1 ? "" : "s"}.`,
      successCriteria: `${describeDailyTarget(metric, target)} on ${req} of ${n} days, recorded by the connected account.`,
      successRule: { type: "daily_completion", requiredDays: req, minParticipants: 1 },
      marketQuestion: req === n ? `Will I hit ${amount(metric, target)} every day for ${n} days?` : `Will I hit ${amount(metric, target)} on ${req} of ${n} days?`,
      initialPriceBps: toBps(atLeast(req, n, p(target))),
    });
  }

  if (community && community.memberCount >= 2) {
    const n = Math.min(10, Math.max(2, Math.ceil(community.memberCount * 0.5)));
    const few = Math.min(3, n);
    const goal = metric.daily.default;
    const per = Math.max(metric.daily.typical, metric.daily.min);
    const groupPlans: (Omit<AppSuggestion, "metric" | "app" | "scope"> & { app?: AppSuggestion["app"] })[] = [
      {
        id: `${metricId}:group-today`, difficulty: "medium", durationDays: 1,
        title: `${n} members ${v} ${amount(metric, goal)} today`,
        description: `Can ${n} people in ${community.name} each hit ${amount(metric, goal)} today?`,
        successCriteria: `At least ${n} participants record ${amount(metric, goal)} or more today on their connected accounts.`,
        successRule: { type: "individual_threshold", unit: metric.unit, threshold: goal, minParticipants: n },
        marketQuestion: `Will ${n} members of ${community.name} ${v} ${amount(metric, goal)} today?`, initialPriceBps: 5000,
      },
      {
        id: `${metricId}:group-one-big`, difficulty: "hard", durationDays: 1,
        title: `One of us: ${amount(metric, daily(goal * 2))} today`,
        description: `Does anyone in ${community.name} have a big day in them?`,
        successCriteria: `At least 1 participant records ${amount(metric, daily(goal * 2))} or more today.`,
        successRule: { type: "individual_threshold", unit: metric.unit, threshold: daily(goal * 2), minParticipants: 1 },
        marketQuestion: `Will someone in ${community.name} ${v} ${amount(metric, daily(goal * 2))} today?`, initialPriceBps: 4500,
      },
      {
        id: `${metricId}:group-day-total`, difficulty: "easy", durationDays: 1,
        title: `${community.name}: ${amount(metric, roundUp(n * per, step * 5))} together today`,
        description: "Everyone's activity today counts toward one total.",
        successCriteria: `${amount(metric, roundUp(n * per, step * 5))} or more in total across all participants today.`,
        successRule: { type: "collective_total", unit: metric.unit, target: roundUp(n * per, step * 5) },
        marketQuestion: `Will ${community.name} reach ${amount(metric, roundUp(n * per, step * 5))} together today?`, initialPriceBps: 5500,
      },
      {
        id: `${metricId}:group-week-total`, difficulty: "medium", durationDays: 7,
        title: `${community.name}: ${amount(metric, roundUp(n * per * 7, step * 10))} this week`,
        description: "Every participant's activity counts toward one group total.",
        successCriteria: `${amount(metric, roundUp(n * per * 7, step * 10))} or more in total across all participants over 7 days.`,
        successRule: { type: "collective_total", unit: metric.unit, target: roundUp(n * per * 7, step * 10) },
        marketQuestion: `Will ${community.name} reach ${amount(metric, roundUp(n * per * 7, step * 10))} this week?`, initialPriceBps: 5000,
      },
      {
        id: `${metricId}:group-streak`, difficulty: "hard", durationDays: 7, app: { metric: metricId, dailyTarget: goal },
        title: `${few} members hit ${amount(metric, goal)} on 5 of 7 days`,
        description: `A week of consistency for ${community.name}.`,
        successCriteria: `At least ${few} participants record ${describeDailyTarget(metric, goal)} on 5 of the 7 days.`,
        successRule: { type: "daily_completion", requiredDays: 5, minParticipants: few },
        marketQuestion: `Will ${few} members of ${community.name} hit ${amount(metric, goal)} on 5 of 7 days?`, initialPriceBps: 4000,
      },
      {
        id: `${metricId}:group-month-total`, difficulty: "hard", durationDays: 30,
        title: `${community.name}: ${amount(metric, roundUp(n * per * 30, step * 10))} in 30 days`,
        description: "A month-long team goal.",
        successCriteria: `${amount(metric, roundUp(n * per * 30, step * 10))} or more in total across all participants over 30 days.`,
        successRule: { type: "collective_total", unit: metric.unit, target: roundUp(n * per * 30, step * 10) },
        marketQuestion: `Will ${community.name} reach ${amount(metric, roundUp(n * per * 30, step * 10))} in 30 days?`, initialPriceBps: 4500,
      },
    ];
    for (const g of groupPlans) add({ ...g, scope: "group" });
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
