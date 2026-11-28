import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import { marketLimits } from "@goalfi/core";
import {
  autoSettleTick,
  challengeMarketLimits,
  confirmChallenge,
  createChallenge,
  joinChallenge,
  lifecycleTick,
  noBetBlockReason,
  tradeRestrictions,
  trackRecord,
  participantPositions,
  reviewEvidence,
  startChallengeNow,
  submitEvidence,
  submitUserTransaction,
  type Actor,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000;
const sig = (n: number) => `SabotageSig${n}`.padEnd(88, "1");
const png = (s: string) => ({ name: `${s}.png`, mimeType: "image/png", bytes: new TextEncoder().encode(`png-${s}`) });

describe("market limits", () => {
  it("grow with creator reputation and trusted participants; easier-to-game metrics get less", () => {
    expect(marketLimits({ easyToGame: false, creatorReputation: 0, trustedParticipants: 0 })).toEqual({ maxInitialLiquidityUsdc: 100, maxTradeUsdc: 20 });
    expect(marketLimits({ easyToGame: false, creatorReputation: 30, trustedParticipants: 9 })).toEqual({ maxInitialLiquidityUsdc: 200, maxTradeUsdc: 200 });
    expect(marketLimits({ easyToGame: false, creatorReputation: 150, trustedParticipants: 100 })).toEqual({ maxInitialLiquidityUsdc: 500, maxTradeUsdc: 500 });
    expect(marketLimits({ easyToGame: true, creatorReputation: 0, trustedParticipants: 3 })).toEqual({ maxInitialLiquidityUsdc: 25, maxTradeUsdc: 20 });
  });
});

describe("anti-manipulation", () => {
  // Account-age rule ON (7 days), unlike other suites.
  const { ctx, gateway, clock, advance } = makeCtx(new Date(), 7);
  let creator: Actor, verifier: Actor, veteran: Actor, saboteur: Actor, honest: Actor, newbie: Actor, admin: Actor;

  beforeAll(async () => {
    await resetDb();
    creator = await makeUser("cre", { walletAddress: "CreatorWallet11111111111111111111111111111" });
    verifier = await makeUser("ver");
    veteran = await makeUser("vet", { walletAddress: "VeteranWallet11111111111111111111111111111" });
    saboteur = await makeUser("sab", { walletAddress: "SaboteurWallet1111111111111111111111111111" });
    honest = await makeUser("hon", { walletAddress: "HonestWallet111111111111111111111111111111" });
    admin = await makeUser("adm", { role: "PLATFORM_ADMIN" });
    // Everyone except the newbie has had their account for 30 days.
    await prisma.user.updateMany({ where: { id: { in: [creator, verifier, veteran, saboteur, honest, admin].map((u) => u.id) } }, data: { createdAt: new Date(clock.now.getTime() - 30 * DAY) } });
    newbie = await makeUser("new");
  });
  afterAll(() => prisma.$disconnect());

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Run 10 km this week", description: "Each of us runs 10 km this week.", categorySlug: "fitness",
    rules: "Runs logged in an app.", successCriteria: "At least 2 participants run 10 km.",
    successRule: { type: "individual_threshold", unit: "km", threshold: 10, minParticipants: 2 },
    evidenceReq: "App screenshot", kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: clock.now, endDate: new Date(clock.now.getTime() + 2 * DAY),
    requiredApprovals: 1, disputeWindowHours: 1, verifierUsernames: [verifier.username], adminUsernames: [],
    marketQuestion: "Will two of us run 10 km?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 50 },
    reviewDeadlineHours: 24, autoSettle: true, ...over,
  });
  async function launch(over: Record<string, unknown> = {}) {
    const c = await createChallenge(ctx, creator, input(over));
    await confirmChallenge(ctx, creator, c.id);
    const m = await prisma.market.findUniqueOrThrow({ where: { challengeId: c.id } });
    await prisma.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    return { c, m: { ...m, status: "OPEN" } };
  }

  it("caps opening liquidity by reputation and metric (platform admins exempt)", async () => {
    await expect(createChallenge(ctx, creator, input({ market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 150 } })))
      .rejects.toMatchObject({ status: 422, details: { initialLiquidityUsdc: [expect.stringMatching(/At most 100/)] } });
    const comm = await prisma.community.create({ data: { slug: `c-${Date.now()}`, name: "C", creatorId: creator.id } });
    await prisma.communityMember.create({ data: { communityId: comm.id, userId: creator.id, role: "OWNER" } });
    const growth = {
      verification: "CONNECTED_APP", app: { metric: "community_members" }, communityId: comm.id, visibility: "COMMUNITY", verifierUsernames: [],
      successRule: { type: "individual_threshold", unit: "members", threshold: 50, minParticipants: 1 }, reviewDeadlineHours: undefined,
    };
    await expect(createChallenge(ctx, creator, input({ ...growth, market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 30 } })))
      .rejects.toMatchObject({ details: { initialLiquidityUsdc: [expect.stringMatching(/At most 25 .*easier to game/)] } });
    await expect(createChallenge(ctx, admin, input({ market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 900 } }))).resolves.toBeTruthy();
  });

  it("new accounts can't join challenges with a market (but can join ones without)", async () => {
    const { c } = await launch();
    await expect(joinChallenge(ctx, newbie, c.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/7 days old/) });
    const plain = await createChallenge(ctx, creator, input({ title: "No market run", market: { type: "NONE" } }));
    await confirmChallenge(ctx, creator, plain.id);
    await prisma.challenge.update({ where: { id: plain.id }, data: { status: "ACTIVE" } });
    await expect(joinChallenge(ctx, newbie, plain.id)).resolves.toBeTruthy();
  });

  it("participants can't bet against themselves: blocked in the UI, flagged if they do it anyway, can't join holding NO", async () => {
    const { c, m } = await launch({ title: "Sabotage-proof run" });
    // An outsider holding NO through GoalFi can't then join.
    gateway.setTx(sig(1), { status: "CONFIRMED", slot: 1, deltas: { collateral: -5_000_000n, yes: 0n, no: 9_000_000n } });
    await submitUserTransaction(ctx, honest, { signature: sig(1), marketId: m.id, kind: "BUY_NO" });
    await expect(joinChallenge(ctx, honest, c.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/hold NO shares/) });

    for (const u of [veteran, saboteur]) await joinChallenge(ctx, u, c.id);
    expect(await noBetBlockReason(ctx, saboteur.id, c.id)).toMatch(/only bet on it succeeding/);
    expect(await noBetBlockReason(ctx, creator.id, c.id)).toMatch(/You run this challenge/);
    expect(await noBetBlockReason(ctx, honest.id, c.id)).toBeNull();

    // The saboteur signs a NO buy with their wallet anyway: recorded and shown publicly.
    gateway.setTx(sig(2), { status: "CONFIRMED", slot: 2, deltas: { collateral: -10_000_000n, yes: 0n, no: 19_000_000n } });
    await submitUserTransaction(ctx, saboteur, { signature: sig(2), marketId: m.id, kind: "BUY_NO" });
    expect((await prisma.participant.findFirstOrThrow({ where: { challengeId: c.id, userId: saboteur.id } })).betAgainstAt).not.toBeNull();
    expect((await participantPositions(ctx, c.id)).get(saboteur.id)).toEqual({ yes: 0n, no: 19_000_000n });
    expect(await prisma.notification.count({ where: { userId: saboteur.id, dedupKey: `SELF_BET:${c.id}:${saboteur.id}` } })).toBe(1);

    // The veteran also holds NO, but bought it with their linked wallet outside GoalFi: found at settlement.
    gateway.holdings.set(`${veteran.walletAddress}:${m.marketAddress}`, { yes: 0n, no: 5_000_000n });
    const e = await submitEvidence(ctx, veteran, c.id, { description: "11 km", progressValue: 11 }, [png("v")]);
    await reviewEvidence(ctx, verifier, e.id, { decision: "APPROVE" });
    advance(2 * DAY + 26 * HOUR);
    await lifecycleTick(ctx);
    advance(2 * HOUR);
    await autoSettleTick(ctx);
    expect(await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "RESOLVED", outcome: "NO" }); // only 1 of 2 ran 10 km
    const parts = await prisma.participant.findMany({ where: { challengeId: c.id }, include: { user: true } });
    const byId = new Map(parts.map((p) => [p.userId, p]));
    expect(byId.get(veteran.id)!.betAgainstAt).not.toBeNull();
    // Penalty only for those who bet against themselves AND failed (the saboteur); the veteran completed.
    expect(await prisma.reputationEvent.findMany({ where: { refId: c.id, activityType: "PENALTY_SELF_BET" }, select: { userId: true, points: true } }))
      .toEqual([{ userId: saboteur.id, points: -50 }]);
    expect(byId.get(saboteur.id)!.user.reputationScore).toBe(-50);
  });

  it("trade limits grow as established participants join", async () => {
    const { c } = await launch({ title: "Growing market" });
    expect((await challengeMarketLimits(ctx, c.id)).maxTradeUsdc).toBe(20);
    await joinChallenge(ctx, veteran, c.id);
    await joinChallenge(ctx, honest, c.id).catch(() => undefined); // holds NO on another market only
    expect((await challengeMarketLimits(ctx, c.id)).maxTradeUsdc).toBe(60);
  });

  it("an upcoming challenge can be started immediately by its admin", async () => {
    const later = new Date(clock.now.getTime() + 3 * HOUR);
    const c = await createChallenge(ctx, creator, input({ title: "Starts later", market: { type: "NONE" }, startDate: later, endDate: new Date(later.getTime() + DAY) }));
    await confirmChallenge(ctx, creator, c.id);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("UPCOMING");
    await expect(startChallengeNow(ctx, veteran, c.id)).rejects.toMatchObject({ status: 403 });
    const started = await startChallengeNow(ctx, creator, c.id);
    expect(started).toMatchObject({ status: "ACTIVE", startDate: clock.now });
    await expect(startChallengeNow(ctx, creator, c.id)).rejects.toMatchObject({ status: 409 });

    // App-verified: the start moves back by whole days, so local-day matching stays exact.
    const midnight = new Date(Math.ceil(clock.now.getTime() / DAY) * DAY + 2 * DAY);
    const app = await createChallenge(ctx, creator, input({
      title: "Steps from the day after tomorrow", market: { type: "NONE" }, verification: "CONNECTED_APP", app: { metric: "steps" }, verifierUsernames: [], reviewDeadlineHours: undefined,
      successRule: { type: "individual_threshold", unit: "steps", threshold: 5000, minParticipants: 1 }, startDate: midnight, endDate: new Date(midnight.getTime() + DAY),
    }));
    await confirmChallenge(ctx, creator, app.id);
    const s2 = await startChallengeNow(ctx, creator, app.id);
    expect(s2.startDate.getTime()).toBe(Math.floor(clock.now.getTime() / DAY) * DAY); // today's (UTC) midnight
    expect((midnight.getTime() - s2.startDate.getTime()) % DAY).toBe(0);
  });

  it("hosts (creator and co-admins) can't trade on their own market; funding it is fine", async () => {
    const coadmin = verifier; // reuse an established account as co-admin
    const c0 = await createChallenge(ctx, creator, input({ title: "Hosted market", marketQuestion: "Hosted?", adminUsernames: [coadmin.username], verifierUsernames: [honest.username] }));
    await confirmChallenge(ctx, creator, c0.id);
    const m = await prisma.market.findUniqueOrThrow({ where: { challengeId: c0.id } });
    await prisma.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
    await prisma.challenge.update({ where: { id: c0.id }, data: { status: "ACTIVE" } });

    expect(await tradeRestrictions(ctx, creator.id, c0.id)).toEqual({ buy: expect.stringMatching(/can’t trade/), no: expect.stringMatching(/can’t trade/) });
    expect((await tradeRestrictions(ctx, coadmin.id, c0.id)).buy).toMatch(/can’t trade/);
    expect(await tradeRestrictions(ctx, veteran.id, c0.id)).toEqual({ buy: null, no: null });

    // Funding the market is allowed and not flagged.
    gateway.setTx(sig(3), { status: "CONFIRMED", slot: 3, deltas: { collateral: -50_000_000n, yes: 0n, no: 0n } });
    await submitUserTransaction(ctx, creator, { signature: sig(3), marketId: m.id, kind: "DEPOSIT_LIQUIDITY" });
    expect((await prisma.market.findUniqueOrThrow({ where: { id: m.id } })).hostTradedAt).toBeNull();

    // Buying YES with their wallet anyway: flagged publicly, penalized once.
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: creator.id } })).reputationScore;
    for (const n of [4, 5]) {
      gateway.setTx(sig(n), { status: "CONFIRMED", slot: n, deltas: { collateral: -5_000_000n, yes: 9_000_000n, no: 0n } });
      await submitUserTransaction(ctx, creator, { signature: sig(n), marketId: m.id, kind: "BUY_YES" });
    }
    expect((await prisma.market.findUniqueOrThrow({ where: { id: m.id } })).hostTradedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: creator.id } })).reputationScore).toBe(before - 50);
    expect((await trackRecord(ctx, creator.id)).hostTrades).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "market.host_traded", entityId: c0.id } })).toBe(2);
  });
});
