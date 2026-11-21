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
