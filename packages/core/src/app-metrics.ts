/**
 * Metrics GoalFi can verify automatically from a connected account (or from data GoalFi already
 * has). Every metric here maps to a documented provider field; see docs/CONNECTED_ACCOUNTS.md.
 */

export const ACCOUNT_PROVIDERS = ["GOOGLE_HEALTH", "WITHINGS", "OURA", "GITHUB", "LICHESS"] as const;
export type AccountProviderId = (typeof ACCOUNT_PROVIDERS)[number];
export type MetricProvider = AccountProviderId | "GOALFI" | "TELEGRAM";

export const PROVIDER_INFO: Record<MetricProvider, { name: string; detail: string; connectable: boolean }> = {
  GOOGLE_HEALTH: { name: "Google Health", detail: "Fitbit and Pixel Watch: steps, distance, workouts, sleep", connectable: true },
  WITHINGS: { name: "Withings", detail: "Withings watches and trackers: steps and distance", connectable: true },
  OURA: { name: "Oura", detail: "Oura Ring: steps, workouts and runs, sleep", connectable: true },
  GITHUB: { name: "GitHub", detail: "Daily contributions (commits, pull requests, issues, reviews)", connectable: true },
  LICHESS: { name: "Lichess", detail: "Chess games played and puzzles solved", connectable: true },
  GOALFI: { name: "GoalFi", detail: "Community membership on GoalFi", connectable: false },
  TELEGRAM: { name: "Telegram", detail: "Members of the community's linked Telegram group", connectable: false },
};

/**
 * - daily: the provider reports one total per local calendar day.
 * - event: individual timestamped activities, counted per challenge day.
 * - level: a current value for the community (e.g. member count), not per participant.
 */
export type MetricSource = "daily" | "event" | "level";

export interface AppMetricDef {
  id: string;
  provider: MetricProvider;
  source: MetricSource;
  /** Unit used in success rules (`successRule.unit`). */
  unit: string;
  /** Short label, e.g. "Steps". */
  label: string;
  /** What is measured, in plain words. */
  description: string;
  category: string;
  /** "lower" metrics (wake-up time) only work with "N days" rules: a day counts at or below the target. */
  better: "higher" | "lower";
  /** Defaults and bounds for "a day counts at …". */
  daily: { default: number; min: number; max: number; step: number; typical: number };
  decimals: number;
  /** Set for metrics that are easier to fake: shown to creators and traders, and markets get smaller limits. */
  easyToGame?: string;
  /** Other accounts that can also supply this metric (the first source is `provider`). */
  alsoFrom?: AccountProviderId[];
}

const m = (d: AppMetricDef): AppMetricDef => d;

export const APP_METRICS = {
  steps: m({
    id: "steps", provider: "GOOGLE_HEALTH", alsoFrom: ["WITHINGS", "OURA"], source: "daily", unit: "steps", label: "Steps", category: "fitness", better: "higher", decimals: 0,
    description: "Daily step count", daily: { default: 8000, min: 100, max: 200_000, step: 500, typical: 6000 },
  }),
  distance_km: m({
    id: "distance_km", provider: "GOOGLE_HEALTH", alsoFrom: ["WITHINGS"], source: "daily", unit: "km", label: "Distance", category: "fitness", better: "higher", decimals: 1,
    description: "Distance walked, run or cycled per day (kilometres)", daily: { default: 5, min: 0.5, max: 300, step: 0.5, typical: 4 },
  }),
  running_km: m({
    id: "running_km", provider: "GOOGLE_HEALTH", alsoFrom: ["OURA"], source: "daily", unit: "km", label: "Running distance", category: "fitness", better: "higher", decimals: 1,
    description: "Distance of runs recorded as a run workout on the watch (walks and rides don't count)", daily: { default: 3, min: 0.5, max: 100, step: 0.5, typical: 2 },
  }),
  floors: m({
    id: "floors", provider: "GOOGLE_HEALTH", source: "daily", unit: "floors", label: "Floors climbed", category: "fitness", better: "higher", decimals: 0,
    description: "Floors climbed per day", daily: { default: 10, min: 1, max: 500, step: 1, typical: 8 },
  }),
  heart_zone_minutes: m({
    id: "heart_zone_minutes", provider: "GOOGLE_HEALTH", source: "daily", unit: "heart-zone minutes", label: "Heart-zone minutes", category: "fitness", better: "higher", decimals: 0,
    description: "Minutes in fat-burn, cardio or peak heart-rate zones per day", daily: { default: 30, min: 5, max: 600, step: 5, typical: 20 },
  }),
  workouts: m({
    id: "workouts", provider: "GOOGLE_HEALTH", alsoFrom: ["OURA"], source: "daily", unit: "workouts", label: "Workouts", category: "fitness", better: "higher", decimals: 0,
    description: "Recorded workouts of 10+ active minutes (gym, runs, rides, swims…)", daily: { default: 1, min: 1, max: 10, step: 1, typical: 0.5 },
  }),
  wake_time: m({
    id: "wake_time", provider: "GOOGLE_HEALTH", alsoFrom: ["OURA"], source: "daily", unit: "wake-up time", label: "Wake-up time", category: "lifestyle", better: "lower", decimals: 0,
    description: "When your main sleep ended (local time), from your watch's sleep tracking", daily: { default: 360, min: 180, max: 720, step: 15, typical: 420 },
  }),
  github_contributions: m({
    id: "github_contributions", provider: "GITHUB", source: "daily", unit: "contributions", label: "GitHub contributions", category: "productivity", better: "higher", decimals: 0,
    description: "Contributions on your GitHub profile calendar per day",
    easyToGame: "Contributions are easy to automate (scripted or empty commits). Best for habit-building; markets get smaller limits.", daily: { default: 1, min: 1, max: 500, step: 1, typical: 2 },
  }),
  lichess_games: m({
    id: "lichess_games", provider: "LICHESS", source: "event", unit: "chess games", label: "Chess games", category: "entertainment", better: "higher", decimals: 0,
    description: "Finished games on Lichess", daily: { default: 3, min: 1, max: 200, step: 1, typical: 3 },
  }),
  lichess_puzzles: m({
    id: "lichess_puzzles", provider: "LICHESS", source: "event", unit: "chess puzzles", label: "Chess puzzles solved", category: "education", better: "higher", decimals: 0,
    description: "Lichess puzzles solved", daily: { default: 10, min: 1, max: 500, step: 5, typical: 10 },
  }),
  community_members: m({
    id: "community_members", provider: "GOALFI", source: "level", unit: "members", label: "Community members", category: "community", better: "higher", decimals: 0,
    description: "Members of the GoalFi community",
    easyToGame: "New accounts can be created to pad the count. Only established members count (accounts older than a week with a linked wallet, Telegram or reputation), and markets get smaller limits.", daily: { default: 1, min: 1, max: 1, step: 1, typical: 0 },
  }),
  telegram_members: m({
    id: "telegram_members", provider: "TELEGRAM", source: "level", unit: "Telegram members", label: "Telegram group members", category: "community", better: "higher", decimals: 0,
    description: "Members of the community's linked Telegram group",
    easyToGame: "Anyone can be added to a Telegram group, including bots and brand-new accounts, and GoalFi can't tell them apart. Markets get smaller limits.", daily: { default: 1, min: 1, max: 1, step: 1, typical: 0 },
  }),
} as const;

export type AppMetricId = keyof typeof APP_METRICS;
export const APP_METRIC_IDS = Object.keys(APP_METRICS) as [AppMetricId, ...AppMetricId[]];

/** Every source that can supply a metric. */
export function metricProviders(m: AppMetricDef): MetricProvider[] {
  return [m.provider, ...(m.alsoFrom ?? [])];
}

/** "Google Health, Withings or Oura". With `only`, just the sources set up on this server. */
export function metricSourceLabel(m: AppMetricDef, only?: Set<string>): string {
  const all = metricProviders(m);
  const shown = only ? all.filter((p) => only.has(p)) : all;
  const names = (shown.length ? shown : all).map((p) => PROVIDER_INFO[p].name);
  return names.length <= 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Combine one day's values from several sources: the best one counts (never summed). */
export function combineDaily(m: AppMetricDef, values: number[]): number {
  return m.better === "lower" ? Math.min(...values) : Math.max(...values);
}

/** Verification methods that read a connected metric / accept uploaded proof. */
export const usesAppMetric = (method: string) => method === "CONNECTED_APP" || method === "HYBRID";
export const acceptsProof = (method: string) => method === "MANUAL" || method === "HYBRID";

export function appMetric(id: string | null | undefined): AppMetricDef | null {
  return id && id in APP_METRICS ? APP_METRICS[id as AppMetricId] : null;
}

/** "06:15" for wake time (minutes after midnight); "12,345" / "5.2" otherwise. */
export function formatMetricValue(metric: AppMetricDef, v: number): string {
  if (metric.id === "wake_time") {
    const h = Math.floor(v / 60), mm = Math.round(v % 60);
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: metric.decimals, minimumFractionDigits: 0 });
}

/** e.g. "8,000+ steps", "5+ km", "wake by 06:00". */
export function describeDailyTarget(metric: AppMetricDef, target: number): string {
  if (metric.better === "lower") return `wake by ${formatMetricValue(metric, target)}`;
  return `${formatMetricValue(metric, target)}+ ${metric.unit}`;
}

/** Whether a day's value meets the daily target. */
export function meetsDailyTarget(metric: AppMetricDef, value: number, target: number): boolean {
  return metric.better === "lower" ? value <= target : value >= target;
}

/** Which success rules a metric supports. */
export function allowedRules(metric: AppMetricDef): ("individual_threshold" | "collective_total" | "daily_completion")[] {
  if (metric.source === "level") return ["individual_threshold"];
  if (metric.better === "lower") return ["daily_completion"];
  return ["individual_threshold", "collective_total", "daily_completion"];
}
