import { timeTransition, type ChallengeStatus } from "@goalfi/core";
import { link, type ServiceContext } from "./context";
import { announceToCommunity, notify } from "./notifications";
import { reconcileResolutions } from "./resolution";
import { applyReviewDeadlines, autoSettleTick, reviewDeadlineReminders } from "./settlement";
import { reconcilePendingTransactions, snapshotMarket } from "./transactions";

const HOUR = 3_600_000;

/** One scheduler tick: time-based status changes, reminders. Safe to run repeatedly. */
export async function lifecycleTick(ctx: ServiceContext) {
  const now = ctx.now();
  const out = { transitioned: 0, marketsClosed: 0, cancelled: 0, reminders: 0, deadlineRejected: 0 };

  const moving = await ctx.db.challenge.findMany({ where: { status: { in: ["UPCOMING", "ACTIVE"] } }, select: { id: true, slug: true, title: true, status: true, startDate: true, endDate: true, creatorId: true, communityId: true } });
  for (const c of moving) {
    const next = timeTransition(c.status as ChallengeStatus, c.startDate, c.endDate, now);
    if (!next) continue;
    const r = await ctx.db.challenge.updateMany({ where: { id: c.id, status: c.status }, data: { status: next } });
    if (r.count === 0) continue;
    out.transitioned++;
    if (next === "IN_REVIEW") {
      const verifiers = await ctx.db.challengeRole.findMany({ where: { challengeId: c.id }, select: { userId: true } });
      await notify(ctx.db, verifiers.map((v) => v.userId), {
        type: "MARKET_UPDATE", message: `“${c.title}” has ended. Finish reviewing submissions so it can be resolved.`,
        link: link(ctx, `/challenges/${c.slug}/review`), dedupKey: `ENDED:${c.id}`,
      });
      await announceToCommunity(ctx.db, c.communityId, { text: `⏱ “${c.title}” has ended. Trading is closed; verification is underway.`, dedupKey: `ANNOUNCE_ENDED:${c.id}` });
    }
  }

  // Markets past end_ts can no longer trade on-chain.
  const closed = await ctx.db.market.updateMany({ where: { status: { in: ["OPEN", "AWAITING_LIQUIDITY"] }, endTs: { lte: now } }, data: { status: "CLOSED" } });
  out.marketsClosed = closed.count;

  // Challenges whose market was never funded before the end date never launched.
  const stale = await ctx.db.challenge.findMany({ where: { status: "PENDING_MARKET", endDate: { lte: now } }, select: { id: true, title: true, slug: true, creatorId: true } });
  for (const c of stale) {
    await ctx.db.challenge.update({ where: { id: c.id }, data: { status: "CANCELLED", suspendedReason: "Market liquidity was not funded before the end date" } });
    await notify(ctx.db, [c.creatorId], { type: "MARKET_UPDATE", message: `“${c.title}” was cancelled: its market was never funded.`, link: link(ctx, `/challenges/${c.slug}`), dedupKey: `CANCELLED:${c.id}` });
    out.cancelled++;
  }

  // Reminders: starting within 24h, ending within 24h.
  const soon = await ctx.db.challenge.findMany({
    where: { OR: [{ status: "UPCOMING", startDate: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } }, { status: "ACTIVE", endDate: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } }] },
    select: { id: true, slug: true, title: true, status: true, participants: { where: { status: "JOINED" }, select: { userId: true } } },
  });
  for (const c of soon) {
    const starting = c.status === "UPCOMING";
    out.reminders += await notify(ctx.db, c.participants.map((p) => p.userId), {
      type: starting ? "CHALLENGE_STARTING" : "CHALLENGE_ENDING",
      message: starting ? `⏰ “${c.title}” starts within 24 hours` : `⏰ “${c.title}” ends within 24 hours. Submit your evidence!`,
      link: link(ctx, `/challenges/${c.slug}`),
      dedupKey: `${starting ? "STARTING" : "ENDING"}:${c.id}`,
    });
  }
  // Review deadlines: unreviewed evidence counts as rejected; warn verifiers 12h before.
  out.deadlineRejected = await applyReviewDeadlines(ctx);
  out.reminders += await reviewDeadlineReminders(ctx);

  // Heartbeat so the admin System status panel can tell whether the scheduler is running.
  await ctx.db.platformSetting.upsert({
    where: { key: "scheduler.lastRun" },
    update: { value: { at: now.toISOString(), ...out } },
    create: { key: "scheduler.lastRun", value: { at: now.toISOString(), ...out } },
  });
  return out;
}

/** Chain-facing maintenance: tx reconciler, stuck resolutions, price snapshots. */
export async function chainTick(ctx: ServiceContext, opts: { snapshotEveryMins?: number } = {}) {
  // Auto-settlement runs even without chain access: challenges without a market settle off-chain.
  const autoSettle = await autoSettleTick(ctx);
  if (!ctx.gateway) return { reconciled: 0, resolutions: 0, snapshots: 0, autoSettle };
  const reconciled = await reconcilePendingTransactions(ctx);
  const resolutions = await reconcileResolutions(ctx);
  const every = (opts.snapshotEveryMins ?? 5) * 60_000;
  const open = await ctx.db.market.findMany({ where: { status: "OPEN" }, select: { id: true, snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { takenAt: true } } } });
  let snapshots = 0;
  for (const m of open) {
    const last = m.snapshots[0]?.takenAt.getTime() ?? 0;
    if (ctx.now().getTime() - last < every) continue;
    if (await snapshotMarket(ctx, m.id).catch(() => null)) snapshots++;
  }
  return { reconciled, resolutions, snapshots, autoSettle };
}
