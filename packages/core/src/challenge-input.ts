import { z } from "zod";
import { SuccessRuleSchema } from "./success-rule";
import { allowedRules, APP_METRIC_IDS, APP_METRICS, describeDailyTarget } from "./app-metrics";

/** Review deadline bounds (hours after the end date). The minimum matches the 24h evidence grace period. */
export const REVIEW_DEADLINE_MIN_HOURS = 24;
export const REVIEW_DEADLINE_MAX_HOURS = 14 * 24;

/** When verifiers must have decided, or null if the challenge has no review deadline. */
export function reviewDeadline(endDate: Date, reviewDeadlineHours: number | null | undefined): Date | null {
  return reviewDeadlineHours ? new Date(endDate.getTime() + reviewDeadlineHours * 3_600_000) : null;
}

/** pm-AMM program bounds (from the IDL error definitions, see docs/PM_AMM_INTEGRATION.md). */
export const PM_AMM_LIMITS = {
  /** `InvalidMarketDuration`: 5 min ≤ d ≤ 30 days (vaults; applied to all GoalFi markets). */
  MARKET_MIN_SECS: 5 * 60,
  MARKET_MAX_SECS: 30 * 86_400,
  /** `InvalidCommitDuration`: 1 min ≤ d ≤ 7 days. */
  COMMIT_MIN_SECS: 60,
  COMMIT_MAX_SECS: 7 * 86_400,
  /** `initial_price_bps`: 0 (= 50/50) or 100..9900. */
  PRICE_MIN_BPS: 100,
  PRICE_MAX_BPS: 9900,
  /** Market name: 1–64 bytes (`InvalidName`). */
  NAME_MAX_BYTES: 64,
  /** Min vault commit: 1 USDC. */
  MIN_COMMIT_USDC: 1,
  GROUP_MIN_LEGS: 2,
  GROUP_MAX_LEGS: 32,
  VAULT_GROUP_MAX_LEGS: 8,
  BET_ALLOWLIST_MAX: 8,
} as const;

export const MarketConfigSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("NONE") }),
    z.object({
      type: z.literal("BINARY"),
      initialPriceBps: z.number().int(),
      /** USDC the creator deposits as initial liquidity from their own wallet. */
      initialLiquidityUsdc: z.number().min(1).max(1_000_000),
    }),
    z.object({
      type: z.literal("COMMITMENT_VAULT"),
      /** Commit phase length before the market can launch. */
      commitHours: z.number().min(1 / 60).max(7 * 24),
      minTotalUsdc: z.number().min(1).max(1_000_000),
    }),
    z.object({
      type: z.literal("MULTI_OUTCOME"),
      legs: z
        .array(z.object({ label: z.string().min(1).max(32), min: z.number().int().min(0), max: z.number().int().nullable() }))
        .min(PM_AMM_LIMITS.GROUP_MIN_LEGS)
        .max(PM_AMM_LIMITS.GROUP_MAX_LEGS),
      budgetPerLegUsdc: z.number().min(1).max(100_000),
    }),
  ])
  .superRefine((m, ctx) => {
    if (m.type === "BINARY") {
      const p = m.initialPriceBps;
      if (p !== 0 && (p < PM_AMM_LIMITS.PRICE_MIN_BPS || p > PM_AMM_LIMITS.PRICE_MAX_BPS))
        ctx.addIssue({ code: "custom", path: ["initialPriceBps"], message: "Initial YES price must be between 1% and 99%" });
    }
    if (m.type === "MULTI_OUTCOME") {
      // Buckets must be contiguous, non-overlapping, starting at 0, last one open-ended.
      const legs = [...m.legs].sort((a, b) => a.min - b.min);
      let expected = 0;
      legs.forEach((leg, i) => {
        if (leg.min !== expected) ctx.addIssue({ code: "custom", path: ["legs", i], message: "Outcome ranges must be contiguous from 0" });
        const last = i === legs.length - 1;
        if (last && leg.max !== null) ctx.addIssue({ code: "custom", path: ["legs", i], message: "Last outcome must be open-ended (e.g. 'more than 20')" });
        if (!last && (leg.max === null || leg.max < leg.min))
          ctx.addIssue({ code: "custom", path: ["legs", i], message: "Invalid range" });
        expected = (leg.max ?? 0) + 1;
      });
    }
  });
export type MarketConfig = z.infer<typeof MarketConfigSchema>;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export const CreateChallengeSchema = z
  .object({
    title: z.string().trim().min(4).max(120),
    description: z.string().trim().min(10).max(5000),
    categorySlug: z.string().min(1),
    rules: z.string().trim().min(10).max(5000),
    successCriteria: z.string().trim().min(5).max(1000),
    successRule: SuccessRuleSchema,
    participationReq: z.string().trim().max(1000).optional(),
    evidenceReq: z.string().trim().min(5).max(1000),
    kind: z.enum(["PERSONAL", "GROUP", "COMPETITION"]),
    visibility: z.enum(["PUBLIC", "COMMUNITY", "PRIVATE"]),
    recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
    communityId: z.string().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    requiredApprovals: z.number().int().min(1).max(20),
    disputeWindowHours: z.number().int().min(1).max(14 * 24),
    /** Hours after the end date for verifiers to decide; evidence not approved by then counts as rejected. */
    reviewDeadlineHours: z.number().int().min(REVIEW_DEADLINE_MIN_HOURS).max(REVIEW_DEADLINE_MAX_HOURS).optional(),
    /** Settle automatically with the computed outcome once nothing blocks resolution. */
    autoSettle: z.boolean().default(false),
    maxParticipants: z.number().int().min(1).max(100_000).optional(),
    verifierUsernames: z.array(z.string().min(1)).max(50),
    /** MANUAL: human verifiers. CONNECTED_APP: progress is synced from connected accounts (see APP_METRICS). */
    verification: z.enum(["MANUAL", "CONNECTED_APP"]).default("MANUAL"),
    /** Required for CONNECTED_APP. dailyTarget: what makes a day count for "N days" rules. */
    app: z.object({ metric: z.enum(APP_METRIC_IDS), dailyTarget: z.number().positive().optional() }).optional(),
    adminUsernames: z.array(z.string().min(1)).max(20),
    /** Short market question shown on the market (stored on-chain as the market name, ≤ 64 bytes). */
    marketQuestion: z.string().trim().min(4).max(200),
    market: MarketConfigSchema,
  })
  .superRefine((c, ctx) => {
    if (c.endDate <= c.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
    const app = c.verification === "CONNECTED_APP";
    if (app) {
      const metric = c.app ? APP_METRICS[c.app.metric] : null;
      if (!metric) ctx.addIssue({ code: "custom", path: ["app"], message: "Choose what is measured" });
      const r = c.successRule;
      if (r.type === "milestone") ctx.addIssue({ code: "custom", path: ["successRule"], message: "App-verified challenges need a measurable goal (an amount, a group total, or days)" });
      else if (metric) {
        if (!allowedRules(metric).includes(r.type))
          ctx.addIssue({
            code: "custom", path: ["successRule"],
            message: metric.source === "level" ? `${metric.label} is measured for the whole community: use “reaches an amount” with 1 participant` : `${metric.label} only works with “on N days” goals`,
          });
        if ((r.type === "individual_threshold" || r.type === "collective_total") && r.unit !== metric.unit)
          ctx.addIssue({ code: "custom", path: ["successRule"], message: `The goal must be measured in ${metric.unit}` });
        if (metric.source === "level") {
          if (!c.communityId) ctx.addIssue({ code: "custom", path: ["communityId"], message: `${metric.label} challenges belong to a community` });
          if (r.type === "individual_threshold" && r.minParticipants !== 1)
            ctx.addIssue({ code: "custom", path: ["successRule"], message: "Community size is one number: set participants who must succeed to 1" });
        }
        if (r.type === "daily_completion") {
          const t = c.app?.dailyTarget;
          if (t === undefined) ctx.addIssue({ code: "custom", path: ["app"], message: `Set what makes a day count (${metric.unit})` });
          else if (t < metric.daily.min || t > metric.daily.max)
            ctx.addIssue({ code: "custom", path: ["app"], message: `A day must count between ${describeDailyTarget(metric, metric.daily.min)} and ${describeDailyTarget(metric, metric.daily.max)}` });
        }
      }
    }
    // App-verified evidence is approved as it syncs, so nothing can be left unreviewed: no deadline needed.
    if (c.autoSettle && c.reviewDeadlineHours === undefined && !app)
      ctx.addIssue({ code: "custom", path: ["reviewDeadlineHours"], message: "Automatic settlement needs a review deadline, so one missing review can't block it forever" });
    if (c.visibility === "COMMUNITY" && !c.communityId)
      ctx.addIssue({ code: "custom", path: ["communityId"], message: "Community challenges need a community" });
    if (c.verification !== "CONNECTED_APP" && c.verifierUsernames.length < c.requiredApprovals)
      ctx.addIssue({ code: "custom", path: ["requiredApprovals"], message: "Required approvals cannot exceed the number of verifiers" });
    if (c.market.type !== "NONE") {
      const secs = (c.endDate.getTime() - Date.now()) / 1000;
      if (secs < PM_AMM_LIMITS.MARKET_MIN_SECS)
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Markets need at least 5 minutes before the end date" });
      if (secs > PM_AMM_LIMITS.MARKET_MAX_SECS)
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Markets can run at most 30 days (pm-AMM limit)" });
    }
    if (c.market.type === "COMMITMENT_VAULT") {
      const commitEnd = Date.now() + c.market.commitHours * 3_600_000;
      if (commitEnd >= c.endDate.getTime())
        ctx.addIssue({ code: "custom", path: ["market", "commitHours"], message: "Funding must close before the challenge ends" });
    }
    if (c.market.type === "MULTI_OUTCOME" && c.successRule.type === "collective_total")
      ctx.addIssue({ code: "custom", path: ["market"], message: "Multi-outcome markets bucket a participant count; use a per-participant rule" });
  });
export type CreateChallengeInput = z.infer<typeof CreateChallengeSchema>;

/** On-chain market name: the question truncated to the program's 64-byte limit on a char boundary. */
export function onchainMarketName(question: string): string {
  let out = "";
  for (const ch of question.trim()) {
    if (utf8Bytes(out + ch) > PM_AMM_LIMITS.NAME_MAX_BYTES) break;
    out += ch;
  }
  return out;
}

/** Map a completer count to the winning leg of a bucketed multi-outcome market. */
export function bucketForCount(legs: { min: number; max: number | null }[], count: number): number {
  const idx = legs.findIndex((l) => count >= l.min && (l.max === null || count <= l.max));
  if (idx < 0) throw new Error(`no bucket for count ${count}`);
  return idx;
}
