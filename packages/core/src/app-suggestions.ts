import { APP_METRICS, describeDailyTarget, formatMetricValue, meetsDailyTarget, type AppMetricDef, type AppMetricId } from "./app-metrics";
import type { SuccessRule } from "./success-rule";

export interface AppSuggestion {
  /** `${metric}:${kind}`, stable so the builder can look it up again. */
  id: string;
  metric: AppMetricId;
  scope: "personal" | "group";
  title: string;
  description: string;
  successCriteria: string;
  successRule: SuccessRule;
  app: { metric: AppMetricId; dailyTarget?: number };
  durationDays: number;
  marketQuestion: string;
  /** Opening YES probability suggestion (bps), from how often the target was hit recently. */
  initialPriceBps: number;
}

const VERB: Partial<Record<AppMetricId, string>> = {
  steps: "Walk", distance_km: "Cover", floors: "Climb", heart_zone_minutes: "Get", workouts: "Do",
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

/**
 * Suggest challenges for one metric from the user's recent daily values (oldest first, complete
 * days only). Personal suggestions scale to the user's own average; group ones to a community.
 * Community-level metrics (member counts) take the community's current value instead.
 */
export function suggestChallenges(
  metricId: AppMetricId,
  recentDaily: number[],
  community?: { name: string; memberCount: number; currentLevel?: number },
): AppSuggestion[] {
  const metric: AppMetricDef = APP_METRICS[metricId];
  const step = metric.daily.step;
  const out: AppSuggestion[] = [];
  const base = { metric: metricId, app: { metric: metricId } } as const;

  if (metric.source === "level") {
    const now = community?.currentLevel;
    if (!community || now === undefined) return [];
    const by = (pct: number, min: number) => Math.max(now + min, Math.ceil((now * pct) / 5) * 5);
    for (const [days, goal, price] of [[7, by(1.1, 5), 4000], [30, by(1.25, 10), 3500]] as const) {
      out.push({
        ...base, id: `${metricId}:grow-${days}`, scope: "group", durationDays: days,
        title: `${community.name} reaches ${formatMetricValue(metric, goal)} ${metric.unit}`,
        description: `From ${formatMetricValue(metric, now)} today to ${formatMetricValue(metric, goal)} within ${days} days.`,
        successCriteria: `${metric.label} is at least ${formatMetricValue(metric, goal)} when the challenge ends, as counted by GoalFi.`,
        successRule: { type: "individual_threshold", unit: metric.unit, threshold: goal, minParticipants: 1 },
        marketQuestion: `Will ${community.name} reach ${formatMetricValue(metric, goal)} ${metric.unit} in ${days} days?`,
        initialPriceBps: price,
      });
    }
    return out;
  }

  const days = recentDaily.filter((d) => Number.isFinite(d) && d >= 0);
  const avg = days.length ? days.reduce((a, b) => a + b, 0) / days.length : metric.daily.typical;

  if (metric.better === "lower") {
    // Wake-up time: "by your usual time" and a 30-minute stretch.
    const usual = clamp(metric, roundUp(avg, step));
    const stretch = clamp(metric, roundDown(avg - 30, step));
    for (const [kind, target, req] of [["usual-week", usual, 7], ["stretch-5of7", stretch, 5]] as const) {
      out.push({
        ...base, id: `${metricId}:${kind}`, scope: "personal", durationDays: 7, app: { metric: metricId, dailyTarget: target },
        title: req === 7 ? `Wake up by ${formatMetricValue(metric, target)} every day this week` : `Wake up by ${formatMetricValue(metric, target)} on 5 of 7 days`,
        description: days.length ? `You usually wake around ${formatMetricValue(metric, avg)}.` : "Based on your watch's sleep tracking.",
        successCriteria: `Main sleep ends by ${formatMetricValue(metric, target)} (local time) on ${req} of the 7 days, recorded by the connected account.`,
        successRule: { type: "daily_completion", requiredDays: req, minParticipants: 1 },
        marketQuestion: req === 7 ? `Will I wake up by ${formatMetricValue(metric, target)} every day this week?` : `Will I wake up by ${formatMetricValue(metric, target)} on 5 of 7 days?`,
        initialPriceBps: toBps(req === 7 ? Math.pow(hitRate(metric, days, target), 7) : hitRate(metric, days, target) * 0.9),
      });
    }
    return out;
  }

  const verb = VERB[metricId] ?? "Log";
  const today = clamp(metric, Math.max(metric.daily.min, roundUp(avg * 1.15, step)));
  const everyDay = clamp(metric, Math.max(metric.daily.min, roundUp(avg * 0.9, step)));
  const week = Math.max(metric.daily.min * 2, roundUp(avg * 7 * 1.1, step));
  out.push(
    {
      ...base, id: `${metricId}:today`, scope: "personal", durationDays: 1,
      title: `${verb} ${amount(metric, today)} today`,
      description: days.length ? `Beat your recent average of ${formatMetricValue(metric, avg)} a day.` : `A first target. It adapts once your data syncs.`,
      successCriteria: `${amount(metric, today)} or more today, recorded by the connected account.`,
      successRule: { type: "individual_threshold", unit: metric.unit, threshold: today, minParticipants: 1 },
      marketQuestion: `Will I ${verb.toLowerCase()} ${amount(metric, today)} today?`,
      initialPriceBps: toBps(hitRate(metric, days, today)),
    },
    {
      ...base, id: `${metricId}:every-day-week`, scope: "personal", durationDays: 7, app: { metric: metricId, dailyTarget: everyDay },
      title: `${amount(metric, everyDay)} every day for a week`,
      description: "Seven days in a row, no days off.",
      successCriteria: `${describeDailyTarget(metric, everyDay)} on each of 7 days, recorded by the connected account.`,
      successRule: { type: "daily_completion", requiredDays: 7, minParticipants: 1 },
      marketQuestion: `Will I hit ${amount(metric, everyDay)} every day this week?`,
      initialPriceBps: toBps(Math.pow(hitRate(metric, days, everyDay), 7)),
    },
    {
      ...base, id: `${metricId}:week-total`, scope: "personal", durationDays: 7,
      title: `${amount(metric, week)} this week`,
      description: "About 10% more than your usual week.",
      successCriteria: `${amount(metric, week)} or more in total over 7 days, recorded by the connected account.`,
      successRule: { type: "individual_threshold", unit: metric.unit, threshold: week, minParticipants: 1 },
      marketQuestion: `Will I ${verb.toLowerCase()} ${amount(metric, week)} this week?`,
      initialPriceBps: 4000,
    },
  );
  if (community && community.memberCount >= 2) {
    const n = Math.min(10, Math.max(2, Math.ceil(community.memberCount * 0.5)));
    const goal = metric.daily.default;
    const groupTotal = roundUp(n * Math.max(metric.daily.typical, metric.daily.min) * 7, step * 10);
    out.push(
      {
        ...base, id: `${metricId}:group-today`, scope: "group", durationDays: 1,
        title: `${n} members ${verb.toLowerCase()} ${amount(metric, goal)} today`,
        description: `Can ${n} people in ${community.name} each hit ${amount(metric, goal)} today?`,
        successCriteria: `At least ${n} participants record ${amount(metric, goal)} or more today on their connected accounts.`,
        successRule: { type: "individual_threshold", unit: metric.unit, threshold: goal, minParticipants: n },
        marketQuestion: `Will ${n} members of ${community.name} ${verb.toLowerCase()} ${amount(metric, goal)} today?`,
        initialPriceBps: 5000,
      },
      {
        ...base, id: `${metricId}:group-week-total`, scope: "group", durationDays: 7,
        title: `${community.name}: ${amount(metric, groupTotal)} this week`,
        description: "Every participant's activity counts toward one group total.",
        successCriteria: `${amount(metric, groupTotal)} or more in total across all participants over 7 days.`,
        successRule: { type: "collective_total", unit: metric.unit, target: groupTotal },
        marketQuestion: `Will ${community.name} reach ${amount(metric, groupTotal)} this week?`,
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
