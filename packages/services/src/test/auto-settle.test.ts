import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  applyReviewDeadlines,
  autoSettleTick,
  confirmChallenge,
  createChallenge,
  joinChallenge,
  lifecycleTick,
  openDispute,
  resolveDispute,
  reviewEvidence,
  submitEvidence,
  type Actor,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000;
const png = (s: string) => ({ name: `${s}.png`, mimeType: "image/png", bytes: new TextEncoder().encode(`png-${s}`) });

describe("review deadline + automatic settlement", () => {
  const { ctx, gateway, clock, advance } = makeCtx();
  let admin: Actor, verifier: Actor, p1: Actor, p2: Actor, p3: Actor;
  beforeAll(async () => {
    await resetDb();
    admin = await makeUser("adm");
    verifier = await makeUser("ver");
    [p1, p2, p3] = (await Promise.all(["pa", "pb", "pc"].map((n) => makeUser(n)))) as [Actor, Actor, Actor];
  });
  afterAll(() => prisma.$disconnect());

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Group run challenge", description: "At least two of us run 10 km this week.", categorySlug: "fitness",
    rules: "Runs must be logged in an app.", successCriteria: "At least 2 participants run 10 km.",
    successRule: { type: "individual_threshold", unit: "km", threshold: 10, minParticipants: 2 },
    evidenceReq: "App screenshot", kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: clock.now, endDate: new Date(clock.now.getTime() + 2 * DAY),
    requiredApprovals: 1, disputeWindowHours: 6, verifierUsernames: [verifier.username], adminUsernames: [],
    marketQuestion: "Will two of us run 10 km?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 10 },
    reviewDeadlineHours: 24, autoSettle: true, ...over,
  });

  async function launch(over: Record<string, unknown> = {}) {
    const c = await createChallenge(ctx, admin, input(over));
    await confirmChallenge(ctx, admin, c.id);
    const m = await prisma.market.findUnique({ where: { challengeId: c.id } });
    if (m) await prisma.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    return c;
  }

  it("rejects 'auto-settle' without a review deadline", async () => {
    await expect(createChallenge(ctx, admin, input({ reviewDeadlineHours: undefined }))).rejects.toMatchObject({ status: 422 });
  });

  it("unreviewed evidence counts as rejected at the deadline, then the market settles by itself", async () => {
    const c = await launch();
    for (const p of [p1, p2, p3]) await joinChallenge(ctx, p, c.id);
    const e1 = await submitEvidence(ctx, p1, c.id, { description: "12 km", progressValue: 12 }, [png("a")]);
    const e2 = await submitEvidence(ctx, p2, c.id, { description: "11 km", progressValue: 11 }, [png("b")]);
    await reviewEvidence(ctx, verifier, e1.id, { decision: "APPROVE" }); // e2 is never reviewed

    advance(2 * DAY + 60_000); // challenge ended
    await lifecycleTick(ctx);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("IN_REVIEW");
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 0, waiting: 1 }); // e2 still awaiting review

    advance(12 * HOUR); // deadline in < 12h → verifiers warned once
    await lifecycleTick(ctx);
    expect(await prisma.notification.count({ where: { userId: verifier.id, dedupKey: `REVIEW_DEADLINE_SOON:${c.id}` } })).toBe(1);

    advance(12 * HOUR); // review deadline passed
    expect(await applyReviewDeadlines(ctx)).toBe(1);
    const auto = await prisma.evidence.findUniqueOrThrow({ where: { id: e2.id } });
    expect(auto).toMatchObject({ status: "REJECTED", autoDecision: "REVIEW_DEADLINE" });
    expect(await prisma.notification.count({ where: { userId: p2.id, type: "EVIDENCE_REJECTED" } })).toBe(1);
    await expect(reviewEvidence(ctx, verifier, e2.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 }); // too late

    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 0, waiting: 1 }); // dispute window still open
    advance(6 * HOUR + 60_000);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 1 });

    const done = await prisma.challenge.findUniqueOrThrow({ where: { id: c.id }, include: { market: true } });
    // Only 1 of the required 2 participants reached 10 km with approved evidence → NO.
    expect(done).toMatchObject({ status: "RESOLVED", outcome: "NO", resolvedById: null });
    expect(done.market).toMatchObject({ status: "RESOLVED", winningOutcome: 2 });
    expect(gateway.markets.get(done.market!.marketAddress!)?.winningSide).toBe("NO");
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "challenge.auto_resolve_started" } })).toBe(1);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 0 }); // never twice
  });

  it("an open dispute holds auto-settlement until an admin rules", async () => {
    const c = await launch({ marketQuestion: "Second run?" });
    await joinChallenge(ctx, p1, c.id);
    const e = await submitEvidence(ctx, p1, c.id, { description: "15 km", progressValue: 15 }, [png("c")]);
    advance(2 * DAY + 25 * HOUR); // ended + past deadline
    await lifecycleTick(ctx);
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: e.id } })).autoDecision).toBe("REVIEW_DEADLINE");
    const d = await openDispute(ctx, p1, e.id, { reason: "Nobody reviewed my run, the screenshot is clear" });
    advance(7 * HOUR);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 0 });
    await resolveDispute(ctx, admin, d.id, { ruling: "UPHELD", note: "Screenshot checked: 15 km" });
    advance(7 * HOUR); // dispute window after the ruling
    const r = await autoSettleTick(ctx);
    expect(r.settled).toBe(1);
    const done = await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } });
    expect(done.outcome).toBe("NO"); // 1 of 2 required participants → still NO, but the run now counts
    expect((await prisma.participant.findFirstOrThrow({ where: { challengeId: c.id, userId: p1.id } })).status).toBe("COMPLETED");
  });

  it("challenges without auto-settle are left for the admin", async () => {
    const c = await launch({ autoSettle: false, marketQuestion: "Manual one?" });
    advance(3 * DAY + 7 * HOUR);
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("IN_REVIEW");
  });
});
