import { audit } from "./audit";
import { flagHostTrade, flagSelfBet, isOfficial, noBetBlockReason } from "./integrity";
import { publishedStatus } from "@goalfi/core";
import type { TxKind } from "@goalfi/db";
import { z } from "zod";
import { afterPublish } from "./challenges";
import { link, type Actor, type ServiceContext } from "./context";
import { conflict, invalid, notFound, ServiceError } from "./errors";
import { notify } from "./notifications";

const USER_KINDS = ["DEPOSIT_LIQUIDITY", "WITHDRAW_LIQUIDITY", "BUY_YES", "BUY_NO", "SELL_YES", "SELL_NO", "REDEEM_PAIR", "CLAIM_WINNINGS", "CLAIM_LP_RESIDUALS"] as const;

export const SubmitTxSchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/, "Invalid transaction signature"),
  marketId: z.string().min(1),
  kind: z.enum(USER_KINDS),
});

/**
 * Expected sign of each balance change for a declared kind. The chain's actual balance deltas
 * are the source of truth; a declared kind that contradicts them is rejected.
 */
function matchesKind(kind: TxKind, d: { collateral: bigint; yes: bigint; no: bigint }): boolean {
  switch (kind) {
    case "BUY_YES": return d.collateral < 0n && d.yes > 0n;
    case "BUY_NO": return d.collateral < 0n && d.no > 0n;
    case "SELL_YES": return d.yes < 0n && d.collateral > 0n;
    case "SELL_NO": return d.no < 0n && d.collateral > 0n;
    case "DEPOSIT_LIQUIDITY": return d.collateral < 0n;
    case "REDEEM_PAIR": return d.yes < 0n && d.no < 0n && d.collateral > 0n;
    case "CLAIM_WINNINGS": return d.collateral >= 0n && (d.yes <= 0n && d.no <= 0n);
    case "WITHDRAW_LIQUIDITY":
    case "CLAIM_LP_RESIDUALS": return d.yes >= 0n && d.no >= 0n;
    default: return false;
  }
}

/** The user reports a signature they sent from their wallet. Recorded PENDING, then verified on-chain. */
export async function submitUserTransaction(ctx: ServiceContext, actor: Actor, raw: unknown) {
  const parsed = SubmitTxSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  if (!actor.walletAddress) throw invalid("Link a wallet first");
  const { signature, marketId, kind } = parsed.data;
  const market = await ctx.db.market.findUnique({ where: { id: marketId } });
  if (!market?.marketAddress) throw notFound("Market not found");
  const existing = await ctx.db.transaction.findUnique({ where: { signature } });
  if (existing) {
    if (existing.userId !== actor.id) throw conflict("This transaction was already submitted by another account");
    return existing.status === "PENDING" ? reconcileTransaction(ctx, existing.id) : existing;
  }
  const tx = await ctx.db.transaction.create({ data: { signature, kind, marketId, userId: actor.id, status: "PENDING" } });
  return reconcileTransaction(ctx, tx.id);
}

/** Verify a PENDING transaction against the chain and apply its effects exactly once. */
export async function reconcileTransaction(ctx: ServiceContext, txId: string) {
  const gw = ctx.gateway;
  if (!gw) throw new ServiceError(503, "Chain access is not configured on this server");
  const tx = await ctx.db.transaction.findUnique({ where: { id: txId }, include: { user: true, market: { include: { challenge: true } } } });
  if (!tx) throw notFound();
  if (tx.status !== "PENDING") return tx;
  if (!tx.user?.walletAddress || !tx.market?.marketAddress) {
    return ctx.db.transaction.update({ where: { id: tx.id }, data: { status: "FAILED", error: "Missing wallet or market" } });
  }
  const v = await gw.verifyUserTx(tx.signature, { owner: tx.user.walletAddress, market: tx.market.marketAddress }).catch((e: Error) => ({ status: "PENDING" as const, reason: e.message }));
  if (v.status === "PENDING") return ctx.db.transaction.update({ where: { id: tx.id }, data: { attempts: { increment: 1 }, error: v.reason ?? null } });
  if (v.status === "FAILED" || !v.deltas)
    return ctx.db.transaction.update({ where: { id: tx.id }, data: { status: "FAILED", error: v.reason ?? "failed", slot: v.slot ? BigInt(v.slot) : null } });
  const d = v.deltas;
  if (!matchesKind(tx.kind, d))
    return ctx.db.transaction.update({ where: { id: tx.id }, data: { status: "FAILED", error: `On-chain balance changes do not match ${tx.kind}` } });

  const market = tx.market;
  const isBuy = tx.kind === "BUY_YES" || tx.kind === "BUY_NO";
  const isSell = tx.kind === "SELL_YES" || tx.kind === "SELL_NO";
  const outcome = tx.kind.endsWith("YES") ? 1 : tx.kind.endsWith("NO") ? 2 : null;
  const amount = isBuy || tx.kind === "DEPOSIT_LIQUIDITY" ? -d.collateral : isSell ? -(outcome === 1 ? d.yes : d.no) : d.collateral > 0n ? d.collateral : 0n;
  const output = isBuy ? (outcome === 1 ? d.yes : d.no) : isSell ? d.collateral : null;

  const confirmed = await ctx.db.$transaction(async (db) => {
    // Conditional: only the first reconciler to flip PENDING→CONFIRMED applies effects.
    const upd = await db.transaction.updateMany({
      where: { id: tx.id, status: "PENDING" },
      data: { status: "CONFIRMED", confirmedAt: ctx.now(), slot: v.slot ? BigInt(v.slot) : null, amount, outputAmount: output, outcome, error: null },
    });
    if (upd.count === 0) return false;
    if (outcome && (isBuy || isSell)) {
      const key = { userId_marketId_outcome: { userId: tx.userId!, marketId: market.id, outcome } };
      await db.position.upsert({
        where: key,
        create: {
          userId: tx.userId!, marketId: market.id, outcome, lastSignature: tx.signature,
          amount: isBuy ? amount : 0n, sharesBought: isBuy ? output ?? 0n : 0n, sharesSold: isSell ? amount : 0n, usdcReceived: isSell ? output ?? 0n : 0n,
        },
        update: {
          lastSignature: tx.signature,
          ...(isBuy ? { amount: { increment: amount }, sharesBought: { increment: output ?? 0n } } : { sharesSold: { increment: amount }, usdcReceived: { increment: output ?? 0n } }),
        },
      });
    }
    if (tx.kind === "DEPOSIT_LIQUIDITY") {
      const m = await db.market.update({ where: { id: market.id }, data: { fundedAmount: { increment: amount } } });
      if (m.status === "AWAITING_LIQUIDITY" && m.fundedAmount >= m.liquidityTargetUsdc) {
        await db.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
        await db.challenge.updateMany({ where: { id: m.challengeId, status: "PENDING_MARKET" }, data: { status: publishedStatus(market.challenge.startDate, ctx.now()) } });
      }
    }
    return true;
  });
  if (confirmed) {
    await snapshotMarket(ctx, market.id).catch(() => undefined);
    const after = await ctx.db.market.findUniqueOrThrow({ where: { id: market.id }, include: { challenge: true } });
    if (tx.kind === "DEPOSIT_LIQUIDITY" && after.status === "OPEN") await afterPublish(ctx, after.challengeId);
    const url = link(ctx, `/challenges/${after.challenge.slug}`);
    if (isBuy && (await isOfficial(ctx, tx.userId!, after.challengeId))) {
      await flagHostTrade(ctx, after.challengeId, tx.userId!, tx.kind);
    } else if (tx.kind === "BUY_NO" && (await noBetBlockReason(ctx, tx.userId!, after.challengeId))) {
      // GoalFi's trade screen doesn't offer this, but a wallet can sign anything: record it publicly.
      if (!(await flagSelfBet(ctx, after.challengeId, tx.userId!, "goalfi_trade")))
        await audit(ctx.db, tx.userId!, "market.self_bet", "Challenge", after.challengeId, { source: "goalfi_trade", role: "creator" });
    }
    if (isBuy || isSell)
      await notify(ctx.db, [tx.userId!], { type: "TRADE_CONFIRMED", message: `Trade confirmed: ${tx.kind.replace("_", " ").toLowerCase()} in “${after.challenge.title}”`, link: url, dedupKey: `TX:${tx.signature}` });
    if (tx.kind === "CLAIM_WINNINGS")
      await notify(ctx.db, [tx.userId!], { type: "CLAIM_CONFIRMED", message: `Winnings claimed from “${after.challenge.title}”`, link: url, dedupKey: `TX:${tx.signature}` });
  }
  return ctx.db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
}

/** Read on-chain pool state and store a price snapshot (indexer + after each trade). */
export async function snapshotMarket(ctx: ServiceContext, marketId: string) {
  const gw = ctx.gateway;
  if (!gw) return null;
  const m = await ctx.db.market.findUnique({ where: { id: marketId } });
  if (!m?.marketAddress) return null;
  const s = await gw.fetchMarket(m.marketAddress);
  if (!s || !s.hasLiquidity) return null;
  const snap = await ctx.db.marketSnapshot.create({
    data: { marketId, yesPrice: s.yesPrice, reserveYes: s.reserveYes, reserveNo: s.reserveNo, lEff: s.lEff, poolValue: s.poolValue },
  });
  await ctx.db.market.update({ where: { id: marketId }, data: { liquidity: BigInt(Math.floor(s.poolValue)) } });
  await priceMoveAlert(ctx, marketId, s.yesPrice).catch((e) => console.error("[price alert]", (e as Error).message));
  return snap;
}

/** A move of this size (in probability) since the last alert notifies holders and participants. */
export const PRICE_ALERT_MOVE = 0.15;

/** Tell people with a stake (YES/NO holders recorded by GoalFi, and participants) about a big price move. */
export async function priceMoveAlert(ctx: ServiceContext, marketId: string, yes: number): Promise<boolean> {
  if (!Number.isFinite(yes)) return false;
  const m = await ctx.db.market.findUnique({ where: { id: marketId }, include: { challenge: { select: { id: true, slug: true, title: true } } } });
  if (!m || m.status !== "OPEN") return false;
  const prev = m.lastAlertPrice;
  if (prev === null) {
    await ctx.db.market.updateMany({ where: { id: marketId, lastAlertPrice: null }, data: { lastAlertPrice: yes } });
    return false;
  }
  if (Math.abs(yes - prev) < PRICE_ALERT_MOVE) return false;
  // Conditional update: concurrent snapshots alert once.
  const r = await ctx.db.market.updateMany({ where: { id: marketId, lastAlertPrice: prev }, data: { lastAlertPrice: yes } });
  if (r.count !== 1) return false;
  const [holders, participants] = await Promise.all([
    ctx.db.position.findMany({ where: { marketId }, select: { userId: true, sharesBought: true, sharesSold: true } }),
    ctx.db.participant.findMany({ where: { challengeId: m.challenge.id, status: { not: "WITHDRAWN" } }, select: { userId: true } }),
  ]);
  const users = [...new Set([...holders.filter((h) => h.sharesBought > h.sharesSold).map((h) => h.userId), ...participants.map((p) => p.userId)])];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  await notify(ctx.db, users, {
    type: "MARKET_UPDATE",
    message: `${yes > prev ? "📈" : "📉"} “${m.challenge.title}”: YES moved from ${pct(prev)} to ${pct(yes)}.`,
    link: link(ctx, `/markets/${m.challenge.slug}`),
    dedupKey: `PRICE:${marketId}:${pct(prev)}:${pct(yes)}:${ctx.now().getTime()}`,
  });
  return true;
}

/** Reconciler pass for transactions still PENDING (e.g. the browser closed before confirmation). */
export async function reconcilePendingTransactions(ctx: ServiceContext, olderThanSecs = 20, maxAttempts = 60): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - olderThanSecs * 1000);
  const pending = await ctx.db.transaction.findMany({ where: { status: "PENDING", createdAt: { lt: cutoff }, userId: { not: null } }, take: 50 });
  for (const t of pending) {
    if (t.attempts >= maxAttempts) await ctx.db.transaction.update({ where: { id: t.id }, data: { status: "FAILED", error: "Not found on-chain after retries (expired)" } });
    else await reconcileTransaction(ctx, t.id).catch(() => undefined);
  }
  return pending.length;
}

export const _test = { matchesKind };
export type { Actor };
