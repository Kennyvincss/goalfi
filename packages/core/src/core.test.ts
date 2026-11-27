import { describe, expect, it } from "vitest";
import {
  applyActivity,
  bucketForCount,
  canOpenDispute,
  canVerify,
  CHALLENGE_TEMPLATES,
  CreateChallengeSchema,
  evaluateResolution,
  evaluateSuccessRule,
  evidenceStatusAfterDispute,
  fromMicro,
  isStreakAlive,
  MarketConfigSchema,
  minOutWithSlippage,
  onchainMarketName,
  periodIndex,
  reviewDeadline,
  suggestChallenges,
  APP_METRIC_IDS,
  APP_METRICS,
  formatMetricValue,
  meetsDailyTarget,
  civilDayInWindow,
  resolutionAwards,
  SuccessRuleSchema,
  tallyVotes,
  timeTransition,
  toMicro,
  verifierAwards,
  type ResolutionInput,
} from "./index";

describe("tallyVotes — 2 of 3 verifiers", () => {
  const v = (id: string, d: "APPROVE" | "REJECT", round = 0) => ({ verifierId: id, decision: d, round });
  it("pending with no votes", () => expect(tallyVotes([], 0, 2, 3).status).toBe("PENDING"));
  it("under review after one approval", () => expect(tallyVotes([v("a", "APPROVE")], 0, 2, 3).status).toBe("UNDER_REVIEW"));
  it("approved at threshold", () => expect(tallyVotes([v("a", "APPROVE"), v("b", "APPROVE")], 0, 2, 3).status).toBe("APPROVED"));
  it("rejected when threshold unreachable", () =>
    expect(tallyVotes([v("a", "REJECT"), v("b", "REJECT")], 0, 2, 3).status).toBe("REJECTED"));
  it("still open with one of each", () =>
    expect(tallyVotes([v("a", "APPROVE"), v("b", "REJECT")], 0, 2, 3).status).toBe("UNDER_REVIEW"));
  it("ignores duplicate votes from the same verifier", () =>
    expect(tallyVotes([v("a", "APPROVE"), v("a", "APPROVE")], 0, 2, 3).approvals).toBe(1));
  it("ignores votes from earlier rounds", () =>
    expect(tallyVotes([v("a", "APPROVE", 0), v("b", "APPROVE", 0)], 1, 2, 3).status).toBe("PENDING"));
  it("single verifier approval", () => expect(tallyVotes([v("a", "APPROVE")], 0, 1, 1).status).toBe("APPROVED"));
  it("throws if threshold can never be met", () => expect(() => tallyVotes([], 0, 3, 2)).toThrow());
});

describe("canVerify", () => {
  const base = { actorId: "v1", verifierIds: ["v1", "v2"], evidenceOwnerId: "p1", evidenceStatus: "PENDING" as const, votes: [], round: 0 };
  it("allows an assigned verifier", () => expect(canVerify(base).ok).toBe(true));
  it("blocks non-verifiers", () => expect(canVerify({ ...base, actorId: "x" }).ok).toBe(false));
  it("blocks self-verification", () => expect(canVerify({ ...base, evidenceOwnerId: "v1" }).ok).toBe(false));
  it("blocks double votes", () =>
    expect(canVerify({ ...base, votes: [{ verifierId: "v1", decision: "APPROVE", round: 0 }] }).ok).toBe(false));
  it("blocks decided evidence", () => expect(canVerify({ ...base, evidenceStatus: "APPROVED" }).ok).toBe(false));
});

describe("disputes", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const base = {
    actorId: "p1", evidenceOwnerId: "p1", participantIds: ["p1", "p2"], evidenceStatus: "REJECTED" as const,
    decidedAt: new Date("2026-06-10T00:00:00Z"), disputeWindowHours: 24, existingDisputes: [], now,
  };
  it("owner can dispute rejection in window", () => expect(canOpenDispute(base).ok).toBe(true));
  it("others cannot dispute a rejection", () => expect(canOpenDispute({ ...base, actorId: "p2" }).ok).toBe(false));
  it("other participant can dispute an approval", () =>
    expect(canOpenDispute({ ...base, evidenceStatus: "APPROVED", actorId: "p2" }).ok).toBe(true));
  it("non-participant cannot dispute an approval", () =>
    expect(canOpenDispute({ ...base, evidenceStatus: "APPROVED", actorId: "zz" }).ok).toBe(false));
  it("window closes", () => expect(canOpenDispute({ ...base, disputeWindowHours: 6 }).ok).toBe(false));
  it("one open dispute at a time", () => expect(canOpenDispute({ ...base, existingDisputes: [{ status: "OPEN" }] }).ok).toBe(false));
  it("upheld flips, dismissed keeps", () => {
    expect(evidenceStatusAfterDispute("REJECTED", "UPHELD")).toBe("APPROVED");
    expect(evidenceStatusAfterDispute("APPROVED", "UPHELD")).toBe("REJECTED");
    expect(evidenceStatusAfterDispute("REJECTED", "DISMISSED")).toBe("REJECTED");
  });
});

describe("success rules", () => {
  const p = (userId: string, values: number[], dates: string[] = []) => ({
    userId,
    approved: values.map((v, i) => ({ progressValue: v, activityDate: dates[i] ?? null })),
  });
  it("individual threshold: 15 participants × 100 km", () => {
    const rule = SuccessRuleSchema.parse({ type: "individual_threshold", unit: "km", threshold: 100, minParticipants: 2 });
    const r = evaluateSuccessRule(rule, [p("a", [60, 40]), p("b", [99]), p("c", [120])]);
    expect(r.completers).toEqual(["a", "c"]);
    expect(r.achieved).toBe(true);
  });
  it("collective total", () => {
    const r = evaluateSuccessRule({ type: "collective_total", unit: "km", target: 1500 }, [p("a", [700]), p("b", [700])]);
    expect(r.achieved).toBe(false);
    expect(r.value).toBe(1400);
  });
  it("daily completion counts distinct days only", () => {
    const r = evaluateSuccessRule({ type: "daily_completion", requiredDays: 2, minParticipants: 1 }, [
      p("a", [1, 1], ["2026-01-01", "2026-01-01"]),
      p("b", [1, 1], ["2026-01-01", "2026-01-02"]),
    ]);
    expect(r.completers).toEqual(["b"]);
  });
  it("all templates have valid rules", () => {
    for (const t of CHALLENGE_TEMPLATES) expect(SuccessRuleSchema.safeParse(t.successRule).success).toBe(true);
    // Every idea is a complete, valid challenge with a market (unique ids, ≤ 30 days).
    expect(new Set(CHALLENGE_TEMPLATES.map((t) => t.id)).size).toBe(CHALLENGE_TEMPLATES.length);
    for (const t of CHALLENGE_TEMPLATES) {
      const start = new Date();
      const r = CreateChallengeSchema.safeParse({
        title: t.title, description: t.description, categorySlug: t.category, rules: t.rules, successCriteria: t.successCriteria,
        successRule: t.successRule, evidenceReq: t.evidenceReq, kind: "GROUP", visibility: "PUBLIC", recurrence: t.recurrence,
        startDate: start, endDate: new Date(start.getTime() + t.durationDays * 86_400_000), requiredApprovals: 1, disputeWindowHours: 24,
        verifierUsernames: ["v"], adminUsernames: [], marketQuestion: t.marketQuestion, reviewDeadlineHours: 48, autoSettle: true,
        market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 10 },
      });
      expect(r.success, `${t.id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });
});

describe("evaluateResolution", () => {
  const ended = new Date("2026-07-01T00:00:00Z");
  const base = (): ResolutionInput => ({
    now: new Date("2026-07-03T00:00:00Z"),
    challenge: { endDate: ended, status: "IN_REVIEW", disputeWindowHours: 24, successRule: { type: "milestone", minCompleters: 1 } },
    marketEndTs: ended,
    marketStatus: "CLOSED",
    evidence: [{ id: "e1", userId: "u1", status: "APPROVED", decidedAt: new Date("2026-07-01T06:00:00Z"), superseded: false }],
    disputes: [],
    progress: [{ userId: "u1", approved: [{ progressValue: null, activityDate: null }] }],
    actor: { id: "admin", isChallengeAdmin: true, isPlatformAdmin: false },
  });
  it("passes when everything is settled", () => {
    const r = evaluateResolution(base());
    expect(r.blockers).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.proposedOutcome).toBe("YES");
  });
  it("blocks before end", () => {
    const i = base();
    i.now = new Date("2026-06-30T00:00:00Z");
    expect(evaluateResolution(i).ok).toBe(false);
  });
  it("blocks on pending evidence", () => {
    const i = base();
    i.evidence.push({ id: "e2", userId: "u2", status: "PENDING", decidedAt: null, superseded: false });
    expect(evaluateResolution(i).blockers.join()).toMatch(/awaiting verification/);
  });
  it("ignores superseded pending evidence", () => {
    const i = base();
    i.evidence.push({ id: "e2", userId: "u2", status: "PENDING", decidedAt: null, superseded: true });
    expect(evaluateResolution(i).ok).toBe(true);
  });
  it("blocks on open dispute", () => {
    const i = base();
    i.disputes.push({ evidenceId: "e1", status: "OPEN", resolvedAt: null });
    expect(evaluateResolution(i).ok).toBe(false);
  });
  it("blocks while dispute window open", () => {
    const i = base();
    i.now = new Date("2026-07-01T12:00:00Z");
    expect(evaluateResolution(i).blockers.join()).toMatch(/Dispute window/);
  });
  it("blocks non-admins", () => {
    const i = base();
    i.actor.isChallengeAdmin = false;
    expect(evaluateResolution(i).ok).toBe(false);
  });
  it("proposes NO when criteria unmet", () => {
    const i = base();
    i.progress = [];
    expect(evaluateResolution(i).proposedOutcome).toBe("NO");
  });
});

describe("reputation", () => {
  it("rewards verifiers who matched the final decision only", () => {
    const a = verifierAwards("e1", "APPROVED", [
      { verifierId: "v1", decision: "APPROVE" },
      { verifierId: "v2", decision: "REJECT" },
    ]);
    expect(a.map((x) => x.userId)).toEqual(["v1"]);
  });
  it("creator reward requires enough participants", () => {
    expect(resolutionAwards({ challengeId: "c", creatorId: "cr", participantCount: 2, completers: [] })).toEqual([]);
    expect(resolutionAwards({ challengeId: "c", creatorId: "cr", participantCount: 3, completers: ["a"] })).toHaveLength(2);
  });
});

describe("streaks", () => {
  it("counts consecutive days and resets on gaps", () => {
    let s = { current: 0, longest: 0, lastActivityDate: null as string | null };
    s = applyActivity(s, "2026-01-01", "DAILY").state;
    s = applyActivity(s, "2026-01-02", "DAILY").state;
    expect(s.current).toBe(2);
    expect(applyActivity(s, "2026-01-02", "DAILY").counted).toBe(false);
    s = applyActivity(s, "2026-01-05", "DAILY").state;
    expect(s).toEqual({ current: 1, longest: 2, lastActivityDate: "2026-01-05" });
  });
  it("reports milestones", () => {
    const s = { current: 6, longest: 6, lastActivityDate: "2026-01-06" };
    expect(applyActivity(s, "2026-01-07", "DAILY").milestonesReached).toEqual([7]);
  });
  it("weeks start on Monday", () => {
    expect(periodIndex("2026-11-16", "WEEKLY")).toBe(periodIndex("2026-11-22", "WEEKLY")); // Mon..Sun
    expect(periodIndex("2026-11-23", "WEEKLY")).toBe(periodIndex("2026-11-16", "WEEKLY") + 1);
  });
  it("alive check", () => {
    const s = { current: 3, longest: 3, lastActivityDate: "2026-01-03" };
    expect(isStreakAlive(s, "2026-01-04", "DAILY")).toBe(true);
    expect(isStreakAlive(s, "2026-01-05", "DAILY")).toBe(false);
  });
});

describe("challenge input", () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000);
  const valid = {
    title: "Run 50 km", description: "Run fifty kilometres this week.", categorySlug: "fitness",
    rules: "Runs must be recorded.", successCriteria: "50 km each", evidenceReq: "Screenshot",
    successRule: { type: "individual_threshold", unit: "km", threshold: 50, minParticipants: 1 },
    kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE", startDate: future(0), endDate: future(7),
    requiredApprovals: 2, disputeWindowHours: 24, verifierUsernames: ["a", "b", "c"], adminUsernames: [],
    marketQuestion: "Will they run 50 km?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 50 },
  };
  it("accepts a valid challenge", () => expect(CreateChallengeSchema.safeParse(valid).success).toBe(true));
  it("rejects approvals > verifiers", () =>
    expect(CreateChallengeSchema.safeParse({ ...valid, verifierUsernames: ["a"] }).success).toBe(false));
  it("rejects markets longer than 30 days", () =>
    expect(CreateChallengeSchema.safeParse({ ...valid, endDate: future(31) }).success).toBe(false));
  it("rejects invalid seed price", () => {
    expect(MarketConfigSchema.safeParse({ type: "BINARY", initialPriceBps: 50, initialLiquidityUsdc: 10 }).success).toBe(false);
    expect(MarketConfigSchema.safeParse({ type: "BINARY", initialPriceBps: 0, initialLiquidityUsdc: 10 }).success).toBe(true);
  });
  it("validates multi-outcome buckets", () => {
    const legs = [
      { label: "0–5", min: 0, max: 5 }, { label: "6–10", min: 6, max: 10 },
      { label: "11–20", min: 11, max: 20 }, { label: ">20", min: 21, max: null },
    ];
    expect(MarketConfigSchema.safeParse({ type: "MULTI_OUTCOME", legs, budgetPerLegUsdc: 10 }).success).toBe(true);
    expect(bucketForCount(legs, 0)).toBe(0);
    expect(bucketForCount(legs, 12)).toBe(2);
    expect(bucketForCount(legs, 99)).toBe(3);
    const gap = [{ label: "a", min: 0, max: 5 }, { label: "b", min: 7, max: null }];
    expect(MarketConfigSchema.safeParse({ type: "MULTI_OUTCOME", legs: gap, budgetPerLegUsdc: 10 }).success).toBe(false);
  });
  it("truncates market names to 64 bytes on char boundaries", () => {
    const name = onchainMarketName("🏃".repeat(40));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(64);
    expect(name).toBe("🏃".repeat(16));
  });
});

describe("money", () => {
  it("parses exactly", () => {
    expect(toMicro("1.5")).toBe(1_500_000n);
    expect(toMicro("0.000001")).toBe(1n);
    expect(toMicro(250)).toBe(250_000_000n);
    expect(() => toMicro("1.0000001")).toThrow();
    expect(fromMicro(1_500_000n)).toBe("1.5");
  });
  it("slippage rounds down", () => expect(minOutWithSlippage(1_000_000n, 100)).toBe(990_000n));
});

describe("lifecycle", () => {
  it("moves through time states", () => {
    const s = new Date("2026-01-01"), e = new Date("2026-01-10");
    expect(timeTransition("UPCOMING", s, e, new Date("2026-01-02"))).toBe("ACTIVE");
    expect(timeTransition("ACTIVE", s, e, new Date("2026-01-11"))).toBe("IN_REVIEW");
    expect(timeTransition("ACTIVE", s, e, new Date("2026-01-05"))).toBeNull();
  });
});

describe("review deadline + auto-settle input", () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000);
  const valid = {
    title: "Run 50 km", description: "Run fifty kilometres this week.", categorySlug: "fitness",
    rules: "Runs must be recorded.", successCriteria: "50 km each", evidenceReq: "Screenshot",
    successRule: { type: "milestone", minCompleters: 1 }, kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: future(0), endDate: future(7), requiredApprovals: 1, disputeWindowHours: 24, verifierUsernames: ["a"], adminUsernames: [],
    marketQuestion: "Will they run 50 km?", market: { type: "NONE" },
  };
  it("auto-settle requires a deadline", () => {
    expect(CreateChallengeSchema.safeParse({ ...valid, autoSettle: true }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...valid, autoSettle: true, reviewDeadlineHours: 48 }).success).toBe(true);
  });
  it("deadline bounds", () => {
    expect(CreateChallengeSchema.safeParse({ ...valid, reviewDeadlineHours: 12 }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...valid, reviewDeadlineHours: 400 }).success).toBe(false);
  });
  it("defaults to manual settlement", () => {
    const r = CreateChallengeSchema.parse(valid);
    expect(r.autoSettle).toBe(false);
    expect(reviewDeadline(new Date("2026-01-01T00:00:00Z"), 48)?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(reviewDeadline(new Date(), null)).toBeNull();
  });
});

describe("connected-app challenges", () => {
  const future = (d: number) => new Date(Date.now() + d * 86_400_000);
  const base = {
    title: "Walk 10k today", description: "Ten thousand steps today.", categorySlug: "fitness",
    rules: "Steps from the connected fitness account count.", successCriteria: "10,000 steps", evidenceReq: "Synced from fitness app",
    successRule: { type: "individual_threshold", unit: "steps", threshold: 10000, minParticipants: 1 },
    kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE", startDate: future(0), endDate: future(1),
    requiredApprovals: 1, disputeWindowHours: 1, verifierUsernames: [], adminUsernames: [],
    marketQuestion: "Will I walk 10k?", market: { type: "NONE" },
    verification: "CONNECTED_APP", app: { metric: "steps" }, autoSettle: true,
  };
  it("needs no verifiers or review deadline", () => expect(CreateChallengeSchema.safeParse(base).success).toBe(true));
  it("requires the goal in the synced unit", () =>
    expect(CreateChallengeSchema.safeParse({ ...base, successRule: { type: "individual_threshold", unit: "km", threshold: 5, minParticipants: 1 } }).success).toBe(false));
  it("rejects milestone goals", () => expect(CreateChallengeSchema.safeParse({ ...base, successRule: { type: "milestone", minCompleters: 1 } }).success).toBe(false));
  it("daily rules need a daily target", () => {
    const daily = { ...base, successRule: { type: "daily_completion", requiredDays: 7, minParticipants: 1 } };
    expect(CreateChallengeSchema.safeParse(daily).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...daily, app: { metric: "steps", dailyTarget: 8000 } }).success).toBe(true);
  });
  it("manual challenges still need verifiers", () =>
    expect(CreateChallengeSchema.safeParse({ ...base, verification: "MANUAL", app: undefined }).success).toBe(false));
});

describe("app metric validation", () => {
  const base = {
    title: "Wake early", description: "Wake up early all week.", categorySlug: "lifestyle",
    rules: "Sleep from the connected account counts.", successCriteria: "Wake by 6", evidenceReq: "Synced automatically",
    kind: "PERSONAL", visibility: "PUBLIC", recurrence: "NONE",
    startDate: new Date(Date.now() + 3_600_000), endDate: new Date(Date.now() + 7 * 86_400_000),
    requiredApprovals: 1, disputeWindowHours: 24, verifierUsernames: [], adminUsernames: [],
    marketQuestion: "Will I wake early?", market: { type: "NONE" }, verification: "CONNECTED_APP", autoSettle: true,
  };
  it("lower-is-better metrics only allow N-days goals with a target in range", () => {
    const days = { type: "daily_completion", requiredDays: 5, minParticipants: 1 };
    expect(CreateChallengeSchema.safeParse({ ...base, successRule: days, app: { metric: "wake_time", dailyTarget: 360 } }).success).toBe(true);
    expect(CreateChallengeSchema.safeParse({ ...base, successRule: days, app: { metric: "wake_time", dailyTarget: 60 } }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...base, successRule: { type: "individual_threshold", unit: "wake-up time", threshold: 360, minParticipants: 1 }, app: { metric: "wake_time" } }).success).toBe(false);
  });
  it("community metrics need a community and one subject", () => {
    const rule = { type: "individual_threshold", unit: "members", threshold: 100, minParticipants: 1 };
    expect(CreateChallengeSchema.safeParse({ ...base, successRule: rule, app: { metric: "community_members" } }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...base, communityId: "c1", successRule: rule, app: { metric: "community_members" } }).success).toBe(true);
    expect(CreateChallengeSchema.safeParse({ ...base, communityId: "c1", successRule: { ...rule, minParticipants: 3 }, app: { metric: "community_members" } }).success).toBe(false);
  });
  it("formats and compares values per metric", () => {
    expect(formatMetricValue(APP_METRICS.wake_time, 375)).toBe("06:15");
    expect(meetsDailyTarget(APP_METRICS.wake_time, 350, 360)).toBe(true);
    expect(meetsDailyTarget(APP_METRICS.wake_time, 370, 360)).toBe(false);
    expect(formatMetricValue(APP_METRICS.distance_km, 5.25)).toBe("5.3");
  });
});

describe("challenge suggestions", () => {
  it("scales personal step targets to the user's history", () => {
    const s = suggestChallenges("steps", [8000, 9000, 8500, 7000, 9500, 8800, 8200]);
    const today = s.find((x) => x.id === "steps:today")!;
    expect(today.successRule).toMatchObject({ type: "individual_threshold", unit: "steps" });
    expect((today.successRule as { threshold: number }).threshold).toBe(10000); // 8,429 avg × 1.15 → 9,693 → 10,000 (rounded to 500)
    expect(s.filter((x) => x.scope === "group")).toHaveLength(0);
  });
  it("adds group suggestions for communities and keeps prices in range", () => {
    const s = suggestChallenges("steps", [], { name: "good or nah", memberCount: 30 });
    const g = s.find((x) => x.id === "steps:group-today")!;
    expect((g.successRule as { minParticipants: number }).minParticipants).toBe(10);
    expect(s.every((x) => x.initialPriceBps >= 1000 && x.initialPriceBps <= 9000)).toBe(true);
  });
  it("every metric's suggestions pass challenge validation", () => {
    const base = {
      description: "Generated from a suggestion.", categorySlug: "fitness", rules: "Synced automatically from the account.",
      evidenceReq: "Synced automatically", kind: "PERSONAL", visibility: "PUBLIC", recurrence: "NONE",
      startDate: new Date(Date.now() + 3_600_000), requiredApprovals: 1, disputeWindowHours: 24, verifierUsernames: [], adminUsernames: [],
      market: { type: "NONE" }, verification: "CONNECTED_APP", autoSettle: true, communityId: "c1",
    };
    let n = 0;
    for (const id of APP_METRIC_IDS) {
      const history = id === "wake_time" ? [400, 410, 395, 420] : [];
      for (const s of suggestChallenges(id, history, { name: "Crew", memberCount: 12, currentLevel: 120 })) {
        const r = CreateChallengeSchema.safeParse({
          ...base, title: s.title, successCriteria: s.successCriteria, successRule: s.successRule, app: s.app, marketQuestion: s.marketQuestion,
          endDate: new Date(Date.now() + 3_600_000 + s.durationDays * 86_400_000),
        });
        expect(r.success, `${s.id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });
  it("suggests wake-up goals from sleep history", () => {
    const s = suggestChallenges("wake_time", [400, 410, 395, 420]); // ~06:46 average
    const by = (id: string) => s.find((x) => x.id === `wake_time:${id}`)!.app.dailyTarget;
    expect([by("usual-week"), by("stretch-5of7"), by("early-week")]).toEqual([420, 375, 390]); // 07:00, 06:15, 06:30
    expect(s.every((x) => x.successRule.type === "daily_completion")).toBe(true);
  });
  it("offers many variants: three difficulties, several time frames, streaks and k-of-n", () => {
    const s = suggestChallenges("running_km", [3, 0, 5, 2.5, 0, 4, 3], { name: "Crew", memberCount: 12 });
    const personal = s.filter((x) => x.scope === "personal");
    expect(personal.length).toBeGreaterThanOrEqual(12);
    expect(new Set(personal.map((x) => x.difficulty))).toEqual(new Set(["easy", "medium", "hard"]));
    expect(new Set(personal.map((x) => x.durationDays))).toEqual(new Set([1, 3, 7, 14, 30]));
    expect(s.filter((x) => x.scope === "group").length).toBeGreaterThanOrEqual(5);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length); // ids are unique
    // Streak odds come from the binomial: hitting 2.5 km on 4 of the last 7 days → 7 in a row is unlikely.
    const streak = s.find((x) => x.id === "running_km:every-day-week")!;
    expect(streak.initialPriceBps).toBe(1000);
  });
  it("dedupes variants that round to the same target", () => {
    const w = suggestChallenges("workouts", []);
    const today = w.filter((x) => x.durationDays === 1);
    expect(today.length).toBeLessThan(3); // 0.5 workouts/day → easy and medium both round to 1
  });
});

describe("civilDayInWindow", () => {
  it("picks exactly the local days of a whole-day challenge in any timezone within ±12h", () => {
    for (const offsetH of [-11, -5, 0, 1, 5.5, 9, 11]) {
      // Local 2026-11-23 00:00 → 2026-11-25 00:00 (two local days) expressed in UTC.
      const start = new Date(Date.UTC(2026, 10, 23) - offsetH * 3_600_000);
      const end = new Date(start.getTime() + 2 * 86_400_000);
      const days = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"].filter((d) => civilDayInWindow(d, start, end));
      expect(days, `UTC${offsetH >= 0 ? "+" : ""}${offsetH}`).toEqual(["2026-11-23", "2026-11-24"]);
    }
  });
});

describe("several sources per metric and watch-or-proof rules", () => {
  it("lists sources and combines a day across them (best value, never the sum)", async () => {
    const { APP_METRICS: M, metricProviders, metricSourceLabel, combineDaily } = await import("./index");
    expect(metricProviders(M.steps)).toEqual(["GOOGLE_HEALTH", "WITHINGS", "OURA"]);
    expect(metricSourceLabel(M.steps)).toBe("Google Health, Withings or Oura");
    expect(metricSourceLabel(M.github_contributions)).toBe("GitHub");
    expect(metricSourceLabel(M.steps, new Set(["GOOGLE_HEALTH", "WITHINGS"]))).toBe("Google Health or Withings"); // Oura not set up: not named
    expect(combineDaily(M.steps, [7000, 9000])).toBe(9000);
    expect(combineDaily(M.wake_time, [400, 380])).toBe(380);
  });
  it("watch or proof needs verifiers and a review deadline for auto-settle, and a provable personal metric", async () => {
    const base = {
      title: "Walk 10k", description: "Ten thousand steps today.", categorySlug: "fitness", rules: "Steps or proof count.",
      successCriteria: "10,000 steps", evidenceReq: "Screenshot", kind: "PERSONAL", visibility: "PUBLIC", recurrence: "NONE",
      startDate: new Date(Date.now() + 3_600_000), endDate: new Date(Date.now() + 86_400_000), requiredApprovals: 1, disputeWindowHours: 24,
      verifierUsernames: ["v"], adminUsernames: [], marketQuestion: "10k?", market: { type: "NONE" },
      verification: "HYBRID", app: { metric: "steps" }, autoSettle: true, reviewDeadlineHours: 24,
      successRule: { type: "individual_threshold", unit: "steps", threshold: 10000, minParticipants: 1 },
    };
    expect(CreateChallengeSchema.safeParse(base).success).toBe(true);
    expect(CreateChallengeSchema.safeParse({ ...base, verifierUsernames: [] }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...base, reviewDeadlineHours: undefined }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...base, app: { metric: "community_members" }, communityId: "c", successRule: { ...base.successRule, unit: "members" } }).success).toBe(false);
    expect(CreateChallengeSchema.safeParse({ ...base, app: { metric: "wake_time", dailyTarget: 400 }, successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 } }).success).toBe(false);
  });
});
