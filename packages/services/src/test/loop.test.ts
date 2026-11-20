import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  confirmChallenge,
  createChallenge,
  joinChallenge,
  lifecycleTick,
  listEvidence,
  openDispute,
  resolutionReport,
  resolveChallenge,
  resolveDispute,
  retryMarketCreation,
  reviewEvidence,
  reviewQueue,
  submitEvidence,
  submitUserTransaction,
  getEvidenceFile,
  type Actor,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sig = () => Array.from(randomBytes(88), (b) => B58[b % 58]).join("");
const DAY = 86_400_000;
const png = (s: string) => ({ name: `${s}.png`, mimeType: "image/png", bytes: new TextEncoder().encode(`fake-png-${s}`) });

describe("full challenge loop (services + Postgres)", () => {
  const { ctx, gateway, clock, advance } = makeCtx();
  let creator: Actor, v1: Actor, v2: Actor, v3: Actor, p1: Actor, p2: Actor, trader: Actor, outsider: Actor;
  let challengeId: string, marketId: string, marketAddress: string, communityId: string;
  const ev = {} as { p1a: string; p2a: string; p1b: string };

  beforeAll(async () => {
    await resetDb();
    creator = await makeUser("creator", { walletAddress: "CreatorWallet111111111111111111111111111111" });
    [v1, v2, v3, p1, p2, outsider] = (await Promise.all(["v1", "v2", "v3", "p1", "p2", "out"].map((n) => makeUser(n)))) as [Actor, Actor, Actor, Actor, Actor, Actor];
    trader = await makeUser("trader", { walletAddress: "TraderWallet1111111111111111111111111111111" });
    const community = await prisma.community.create({
      data: { slug: "runners", name: "Runners", creatorId: creator.id, telegramChatId: -100123n, members: { create: [{ userId: creator.id, role: "OWNER" }, { userId: p1.id }] } },
    });
    communityId = community.id;
  });
  afterAll(() => prisma.$disconnect());

  const base = () => ({
    title: "30-Day Running Challenge",
    description: "Can this community collectively complete 1,500 km of running within 30 days?",
    categorySlug: "fitness",
    rules: "Runs must be logged by a fitness app.",
    successCriteria: "At least 1 participant runs 100 km.",
    successRule: { type: "individual_threshold", unit: "km", threshold: 100, minParticipants: 1 },
    evidenceReq: "Screenshot from a fitness app.",
    kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    communityId,
    startDate: clock.now, endDate: new Date(clock.now.getTime() + 10 * DAY),
    requiredApprovals: 2, disputeWindowHours: 24,
    verifierUsernames: [v1.username, v2.username, v3.username], adminUsernames: [],
    marketQuestion: "Will the community complete the challenge?",
    market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 50 },
  });

  it("validates the draft", async () => {
    await expect(createChallenge(ctx, creator, { ...base(), verifierUsernames: [v1.username] })).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, creator, { ...base(), verifierUsernames: ["nobody_here", v1.username, v2.username] })).rejects.toThrow(/Unknown verifier/);
    await expect(createChallenge(ctx, outsider, base())).rejects.toMatchObject({ status: 403 }); // not a community admin
  });

  it("creates a DRAFT that nobody else can see or join", async () => {
    const c = await createChallenge(ctx, creator, base());
    challengeId = c.id;
    expect(c.status).toBe("DRAFT");
    await expect(joinChallenge(ctx, p1, c.id)).rejects.toMatchObject({ status: 404 });
  });

  it("confirm creates the on-chain market (retrying after a failure) and waits for liquidity", async () => {
    gateway.failNextCreate = true;
    await expect(confirmChallenge(ctx, creator, challengeId)).rejects.toMatchObject({ status: 502 });
    let m = await prisma.market.findUniqueOrThrow({ where: { challengeId } });
    expect(m.status).toBe("CREATING");
    expect(m.lastError).toMatch(/blockhash/);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("PENDING_MARKET");
    await expect(confirmChallenge(ctx, creator, challengeId)).rejects.toMatchObject({ status: 409 }); // rules already frozen
    await retryMarketCreation(ctx, creator, challengeId);
    m = await prisma.market.findUniqueOrThrow({ where: { challengeId } });
    expect(m.status).toBe("AWAITING_LIQUIDITY");
    expect(m.creationSignature).toBeTruthy();
    expect(m.liquidityTargetUsdc).toBe(50_000_000n);
    marketId = m.id;
    marketAddress = m.marketAddress!;
  });

  it("goes live only after confirmed funding ≥ target, and announces to the Telegram group", async () => {
    const s1 = sig();
    gateway.setTx(s1, { status: "CONFIRMED", slot: 1, deltas: { collateral: -20_000_000n, yes: 0n, no: 0n } });
    await submitUserTransaction(ctx, creator, { signature: s1, marketId, kind: "DEPOSIT_LIQUIDITY" });
    expect((await prisma.market.findUniqueOrThrow({ where: { id: marketId } })).status).toBe("AWAITING_LIQUIDITY");
    const s2 = sig();
    gateway.setTx(s2, { status: "CONFIRMED", slot: 2, deltas: { collateral: -30_000_000n, yes: 0n, no: 0n } });
    gateway.setPool(marketAddress, 0.5, 50_000_000);
    await submitUserTransaction(ctx, creator, { signature: s2, marketId, kind: "DEPOSIT_LIQUIDITY" });
    const m = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    expect(m.status).toBe("OPEN");
    expect(m.fundedAmount).toBe(50_000_000n);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("ACTIVE");
    expect(await prisma.telegramOutbox.count({ where: { chatId: -100123n } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: p1.id, type: "CHALLENGE_NEW" } })).toBe(1);
    expect(await prisma.marketSnapshot.count({ where: { marketId } })).toBe(1);
  });

  it("verifies user trades against chain balance changes, idempotently", async () => {
    const s = sig();
    gateway.setTx(s, { status: "CONFIRMED", slot: 3, deltas: { collateral: -10_000_000n, yes: 18_500_000n, no: 0n } });
    await expect(submitUserTransaction(ctx, trader, { signature: s, marketId, kind: "BUY_NO" })).resolves.toMatchObject({ status: "FAILED" });
    const s2 = sig();
    gateway.setTx(s2, { status: "CONFIRMED", slot: 4, deltas: { collateral: -10_000_000n, yes: 18_500_000n, no: 0n } });
    const t = await submitUserTransaction(ctx, trader, { signature: s2, marketId, kind: "BUY_YES" });
    expect(t).toMatchObject({ status: "CONFIRMED", amount: 10_000_000n, outputAmount: 18_500_000n, outcome: 1 });
    await submitUserTransaction(ctx, trader, { signature: s2, marketId, kind: "BUY_YES" }); // replay: no double counting
    const pos = await prisma.position.findUniqueOrThrow({ where: { userId_marketId_outcome: { userId: trader.id, marketId, outcome: 1 } } });
    expect(pos.sharesBought).toBe(18_500_000n);
    await expect(submitUserTransaction(ctx, creator, { signature: s2, marketId, kind: "BUY_YES" })).rejects.toMatchObject({ status: 409 });
    const pending = sig();
    expect((await submitUserTransaction(ctx, trader, { signature: pending, marketId, kind: "BUY_NO" })).status).toBe("PENDING");
  });

  it("handles joining and evidence rules", async () => {
    await joinChallenge(ctx, p1, challengeId);
    await joinChallenge(ctx, p2, challengeId);
    await expect(joinChallenge(ctx, p1, challengeId)).rejects.toMatchObject({ status: 409 });
    await expect(submitEvidence(ctx, outsider, challengeId, { description: "ran", progressValue: 5 }, [png("x")])).rejects.toMatchObject({ status: 403 });
    await expect(submitEvidence(ctx, p1, challengeId, { description: "ran far" }, [png("a")])).rejects.toThrow(/progress in km/);
    await expect(submitEvidence(ctx, p1, challengeId, { description: "ran far", progressValue: 5 }, [{ name: "x.exe", mimeType: "application/x-msdownload", bytes: new Uint8Array([1]) }])).rejects.toThrow(/Unsupported/);
    ev.p1a = (await submitEvidence(ctx, p1, challengeId, { description: "Week 1 runs", progressValue: 60 }, [png("p1a")])).id;
    ev.p2a = (await submitEvidence(ctx, p2, challengeId, { description: "Short jog", progressValue: 30, links: ["https://strava.com/a/1"] }, [])).id;
    const e = await prisma.evidence.findUniqueOrThrow({ where: { id: ev.p1a }, include: { files: true } });
    expect(e.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.files).toHaveLength(1);
    expect(await prisma.notification.count({ where: { type: "EVIDENCE_RECEIVED", userId: { in: [v1.id, v2.id, v3.id] } } })).toBe(6);
  });

  it("protects evidence files and hides unreviewed evidence from the public", async () => {
    const f = await prisma.evidenceFile.findFirstOrThrow({ where: { evidenceId: ev.p1a } });
    await expect(getEvidenceFile(ctx, outsider, f.id)).rejects.toMatchObject({ status: 404 });
    await expect(getEvidenceFile(ctx, v1, f.id)).resolves.toMatchObject({ mimeType: "image/png" });
    expect((await listEvidence(ctx, outsider, challengeId)).length).toBe(0);
    expect((await listEvidence(ctx, v1, challengeId)).length).toBe(2);
  });

  it("applies the 2-of-3 threshold and blocks self/duplicate votes", async () => {
    expect((await reviewQueue(ctx, v1, challengeId)).map((e) => e.id).sort()).toEqual([ev.p1a, ev.p2a].sort());
    await expect(reviewEvidence(ctx, p1, ev.p1a, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    expect(await reviewEvidence(ctx, v1, ev.p1a, { decision: "APPROVE" })).toMatchObject({ status: "UNDER_REVIEW" });
    await expect(reviewEvidence(ctx, v1, ev.p1a, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    expect(await reviewEvidence(ctx, v2, ev.p1a, { decision: "APPROVE" })).toMatchObject({ status: "APPROVED" });
    await expect(reviewEvidence(ctx, v3, ev.p1a, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 }); // already decided
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p1.id } })).reputationScore).toBe(5);
    await expect(reviewEvidence(ctx, v1, ev.p2a, { decision: "REJECT" })).rejects.toThrow(/Validation/); // reason required
    await reviewEvidence(ctx, v1, ev.p2a, { decision: "REJECT", reason: "Distance not visible" });
    expect(await reviewEvidence(ctx, v2, ev.p2a, { decision: "REJECT", reason: "Agree" })).toMatchObject({ status: "REJECTED" });
  });

  it("lets the submitter dispute a rejection and an admin overturn it", async () => {
    await expect(openDispute(ctx, p1, ev.p2a, { reason: "Not my evidence to dispute here" })).rejects.toMatchObject({ status: 403 });
    const d = await openDispute(ctx, p2, ev.p2a, { reason: "The Strava link clearly shows 30 km" });
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: ev.p2a } })).status).toBe("DISPUTED");
    await expect(openDispute(ctx, p2, ev.p2a, { reason: "again and again and again" })).rejects.toMatchObject({ status: 409 });
    await expect(resolveDispute(ctx, v1, d.id, { ruling: "UPHELD", note: "looks fine" })).rejects.toMatchObject({ status: 403 }); // verifier ≠ admin
    expect(await resolveDispute(ctx, creator, d.id, { ruling: "UPHELD", note: "Link verified" })).toEqual({ ruling: "UPHELD", finalStatus: "APPROVED" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p2.id } })).reputationScore).toBe(5);
  });

  it("blocks resolution until the challenge ends, everything is reviewed and windows close", async () => {
    let r = await resolutionReport(ctx, creator, challengeId);
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/not ended/);
    ev.p1b = (await submitEvidence(ctx, p1, challengeId, { description: "Week 2 runs", progressValue: 50 }, [png("p1b")])).id;
    advance(10 * DAY + 1000);
    const tick = await lifecycleTick(ctx);
    expect(tick.transitioned).toBe(1);
    expect(tick.marketsClosed).toBe(1);
    r = await resolutionReport(ctx, creator, challengeId);
    expect(r.blockers.join()).toMatch(/awaiting verification/);
    await reviewEvidence(ctx, v1, ev.p1b, { decision: "APPROVE" });
    await reviewEvidence(ctx, v3, ev.p1b, { decision: "APPROVE" });
    r = await resolutionReport(ctx, creator, challengeId);
    expect(r.blockers.join()).toMatch(/Dispute window/);
    advance(25 * 3_600_000);
    r = await resolutionReport(ctx, creator, challengeId);
    expect(r).toMatchObject({ ok: true, proposedOutcome: "YES" });
    expect(r.evaluation.completers).toEqual([p1.id]);
    await expect(resolutionReport(ctx, outsider, challengeId)).resolves.toMatchObject({ ok: false });
  });

  it("resolves on-chain, then finalizes participants, reputation and winners", async () => {
    await expect(resolveChallenge(ctx, v1, challengeId, { outcome: "YES", confirm: true })).rejects.toMatchObject({ status: 403 });
    await expect(resolveChallenge(ctx, creator, challengeId, { outcome: "NO", confirm: true })).rejects.toMatchObject({ status: 409 });
    const c = await resolveChallenge(ctx, creator, challengeId, { outcome: "YES", confirm: true });
    expect(c).toMatchObject({ status: "RESOLVED", outcome: "YES" });
    const m = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    expect(m).toMatchObject({ status: "RESOLVED", winningOutcome: 1 });
    expect(m.resolutionSignature).toBeTruthy();
    expect(gateway.markets.get(marketAddress)?.winningSide).toBe("YES");
    const parts = await prisma.participant.findMany({ where: { challengeId }, select: { userId: true, status: true } });
    expect(parts.find((p) => p.userId === p1.id)?.status).toBe("COMPLETED");
    expect(parts.find((p) => p.userId === p2.id)?.status).toBe("FAILED");
    // p1: 2 approvals ×5 + completion 25 = 35
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p1.id } })).reputationScore).toBe(35);
    // v1 voted with the final outcome on p1a, p1b (approve) but REJECTED p2a which was overturned → 2 fair votes
    expect(await prisma.reputationEvent.count({ where: { userId: v1.id, activityType: "FAIR_VERIFICATION" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: trader.id, type: "WINNINGS_AVAILABLE" } })).toBe(1);
    expect(await prisma.telegramOutbox.count({ where: { dedupKey: `ANNOUNCE_RESOLVED:${challengeId}` } })).toBe(1);
    await expect(resolveChallenge(ctx, creator, challengeId, { outcome: "YES", confirm: true })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses evidence edits at the database level", async () => {
    await expect(prisma.evidence.update({ where: { id: ev.p1a }, data: { progressValue: 500 } })).rejects.toThrow(/immutable/);
  });

  it("challenges without markets publish immediately on confirm", async () => {
    const c = await createChallenge(ctx, creator, { ...base(), communityId: undefined, startDate: clock.now, endDate: new Date(clock.now.getTime() + 5 * DAY), market: { type: "NONE" } });
    const r = await confirmChallenge(ctx, creator, c.id);
    expect(r.challenge.status).toBe("ACTIVE");
    expect(r.market).toBeNull();
  });
});
