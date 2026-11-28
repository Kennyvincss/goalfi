import { accountOldEnough, award, easyToGameReason, marketLimits, netShares, type MarketLimits } from "@goalfi/core";
import { applyAwards } from "./reputation";
import { link, trustDays, type ServiceContext } from "./context";
import { notify } from "./notifications";
import { audit } from "./audit";

/** Participants whose GoalFi account is old enough to be trusted (and who haven't bet against themselves). */
export async function trustedParticipantCount(ctx: ServiceContext, challengeId: string): Promise<number> {
  const ps = await ctx.db.participant.findMany({
    where: { challengeId, status: { not: "WITHDRAWN" }, betAgainstAt: null },
    select: { user: { select: { createdAt: true } } },
  });
  return ps.filter((p) => accountOldEnough(p.user.createdAt, ctx.now(), trustDays(ctx))).length;
}

/** Current market limits for a challenge, and why it's easier to game (if it is). */
export async function challengeMarketLimits(ctx: ServiceContext, challengeId: string): Promise<MarketLimits & { easyToGame: string | null }> {
  const c = await ctx.db.challenge.findUniqueOrThrow({ where: { id: challengeId }, select: { verificationMethod: true, appMetric: true, creator: { select: { reputationScore: true } } } });
  const easyToGame = easyToGameReason(c);
  return { ...marketLimits({ easyToGame: !!easyToGame, creatorReputation: c.creator.reputationScore, trustedParticipants: await trustedParticipantCount(ctx, challengeId) }), easyToGame };
}

/** The challenge's hosts: its creator and co-admins. They run it, so they may not trade on its market. */
export async function isHost(ctx: ServiceContext, userId: string, challengeId: string): Promise<boolean> {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId }, select: { creatorId: true } });
  if (!c) return false;
  if (c.creatorId === userId) return true;
  return (await ctx.db.challengeRole.count({ where: { challengeId, userId, role: "ADMIN" } })) > 0;
}

export const HOST_TRADE_MESSAGE = "You run this challenge, so you can’t trade on its market. Funding it with liquidity is fine.";

/**
 * What a user may not do on a challenge's market through GoalFi:
 * hosts (creator, co-admins) can't buy at all; participants can't buy NO (bet against themselves).
 * Selling is always allowed, so existing positions can be closed.
 */
export async function tradeRestrictions(ctx: ServiceContext, userId: string, challengeId: string): Promise<{ buy: string | null; no: string | null }> {
  if (await isHost(ctx, userId, challengeId)) return { buy: HOST_TRADE_MESSAGE, no: HOST_TRADE_MESSAGE };
  return { buy: null, no: await noBetBlockReason(ctx, userId, challengeId) };
}

/** Why a participant may not buy NO (they'd be betting against themselves), or null. */
export async function noBetBlockReason(ctx: ServiceContext, userId: string, challengeId: string): Promise<string | null> {
  const p = await ctx.db.participant.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
  if (p && p.status !== "WITHDRAWN") return "You’re taking part in this challenge, so you can only bet on it succeeding (YES). Betting against yourself isn’t allowed.";
  if (await isHost(ctx, userId, challengeId)) return HOST_TRADE_MESSAGE;
  return null;
}

/** A host traded on their own market anyway (a wallet can sign anything): flag it publicly and apply the penalty once. */
export async function flagHostTrade(ctx: ServiceContext, challengeId: string, userId: string, kind: string) {
  const m = await ctx.db.market.findUnique({ where: { challengeId }, select: { id: true } });
  if (m) await ctx.db.market.updateMany({ where: { id: m.id, hostTradedAt: null }, data: { hostTradedAt: ctx.now() } });
  await audit(ctx.db, userId, "market.host_traded", "Challenge", challengeId, { kind });
  const applied = await applyAwards(ctx.db, [award(userId, "PENALTY_HOST_TRADED", challengeId)]);
  if (applied) {
    const c = await ctx.db.challenge.findUniqueOrThrow({ where: { id: challengeId }, select: { slug: true, title: true } });
    await notify(ctx.db, [userId], {
      type: "MARKET_UPDATE",
      message: `⚠️ You traded on the market of “${c.title}”, which you run. Hosts aren’t allowed to trade: this is shown publicly and cost 50 reputation.`,
      link: link(ctx, `/challenges/${c.slug}`),
      dedupKey: `HOST_TRADED:${challengeId}:${userId}`,
    });
  }
}

/** Whether a user holds NO shares on a market: trades recorded by GoalFi, or their linked wallet on-chain. */
export async function holdsNo(ctx: ServiceContext, user: { id: string; walletAddress: string | null }, market: { id: string; marketAddress: string | null }): Promise<boolean> {
  const pos = await ctx.db.position.findUnique({ where: { userId_marketId_outcome: { userId: user.id, marketId: market.id, outcome: 2 } } });
  if (pos && netShares(pos) > 0n) return true;
  if (ctx.gateway && user.walletAddress && market.marketAddress) {
    const h = await ctx.gateway.readHoldings({ owner: user.walletAddress, market: market.marketAddress }).catch(() => null);
    if (h && h.no > 0n) return true;
  }
  return false;
}

/** Mark a participant as having bet against their own challenge. Public on the challenge page; penalized if they fail. */
export async function flagSelfBet(ctx: ServiceContext, challengeId: string, userId: string, source: "goalfi_trade" | "wallet_scan") {
  const r = await ctx.db.participant.updateMany({ where: { challengeId, userId, betAgainstAt: null }, data: { betAgainstAt: ctx.now() } });
  if (r.count !== 1) return false;
  await audit(ctx.db, userId, "market.self_bet", "Challenge", challengeId, { source });
  const c = await ctx.db.challenge.findUniqueOrThrow({ where: { id: challengeId }, select: { slug: true, title: true } });
  await notify(ctx.db, [userId], {
    type: "MARKET_UPDATE",
    message: `⚠️ You hold NO shares on “${c.title}”, which you’re taking part in. This is shown publicly, and you lose reputation if you don’t complete it.`,
    link: link(ctx, `/challenges/${c.slug}`),
    dedupKey: `SELF_BET:${challengeId}:${userId}`,
  });
  return true;
}

/** At settlement: check every participant's linked wallet for NO shares (catches trades made outside GoalFi). */
export async function scanSelfBets(ctx: ServiceContext, challengeId: string): Promise<number> {
  const m = await ctx.db.market.findUnique({ where: { challengeId } });
  if (!m?.marketAddress) return 0;
  const ps = await ctx.db.participant.findMany({
    where: { challengeId, status: { not: "WITHDRAWN" }, betAgainstAt: null },
    select: { userId: true, user: { select: { walletAddress: true } } },
  });
  let flagged = 0;
  for (const p of ps)
    if (await holdsNo(ctx, { id: p.userId, walletAddress: p.user.walletAddress }, m)) flagged += (await flagSelfBet(ctx, challengeId, p.userId, "wallet_scan")) ? 1 : 0;
  return flagged;
}

/** Net YES/NO shares per participant from GoalFi-recorded trades, for public display. */
export async function participantPositions(ctx: ServiceContext, challengeId: string): Promise<Map<string, { yes: bigint; no: bigint }>> {
  const m = await ctx.db.market.findUnique({ where: { challengeId }, select: { id: true } });
  const out = new Map<string, { yes: bigint; no: bigint }>();
  if (!m) return out;
  const ps = await ctx.db.participant.findMany({ where: { challengeId, status: { not: "WITHDRAWN" } }, select: { userId: true } });
  const positions = await ctx.db.position.findMany({ where: { marketId: m.id, userId: { in: ps.map((p) => p.userId) } } });
  for (const p of positions) {
    const cur = out.get(p.userId) ?? { yes: 0n, no: 0n };
    if (p.outcome === 1) cur.yes += netShares(p);
    else if (p.outcome === 2) cur.no += netShares(p);
    out.set(p.userId, cur);
  }
  return out;
}
