import { isStreakAlive, type StreakPeriod, type TrackRecord } from "@goalfi/core";
import { audit } from "./audit";
import type { Actor, ServiceContext } from "./context";

/** A user's public track record, computed from real activity. */
export async function trackRecord(ctx: ServiceContext, userId: string): Promise<TrackRecord> {
  const db = ctx.db;
  const [joined, completed, failed, streaks, hosted, hostedSettled, hostedYes, marketsHosted, fair, overturned, selfBet, appDone, user] = await Promise.all([
    db.participant.count({ where: { userId } }),
    db.participant.count({ where: { userId, status: "COMPLETED" } }),
    db.participant.count({ where: { userId, status: "FAILED" } }),
    db.streak.aggregate({ where: { userId }, _max: { current: true, longest: true } }),
    db.challenge.count({ where: { creatorId: userId, status: { notIn: ["DRAFT", "CANCELLED", "PENDING_MARKET"] } } }),
    db.challenge.count({ where: { creatorId: userId, status: "RESOLVED" } }),
    db.challenge.count({ where: { creatorId: userId, status: "RESOLVED", outcome: "YES" } }),
    db.market.count({ where: { challenge: { creatorId: userId }, status: { notIn: ["CREATING", "FAILED"] } } }),
    db.reputationEvent.count({ where: { userId, activityType: "FAIR_VERIFICATION" } }),
    db.reputationEvent.count({ where: { userId, activityType: "PENALTY_EVIDENCE_OVERTURNED" } }),
    db.participant.count({ where: { userId, betAgainstAt: { not: null } } }),
    db.participant.count({ where: { userId, status: "COMPLETED", challenge: { verificationMethod: { in: ["CONNECTED_APP", "HYBRID"] } } } }),
    db.user.findUnique({ where: { id: userId }, select: { reputationScore: true } }),
  ]);
  return {
    joined, completed, failed,
    currentStreak: streaks._max.current ?? 0, longestStreak: streaks._max.longest ?? 0,
    hosted, hostedSettled, hostedYes, marketsHosted,
    fairVerifications: fair, overturned, selfBetFlags: selfBet, appVerifiedCompleted: appDone,
    reputation: user?.reputationScore ?? 0,
  };
}

/** Streaks that are still alive (the last activity is in the current or previous period). */
export async function activeStreaks(ctx: ServiceContext, userId: string) {
  const rows = await ctx.db.streak.findMany({
    where: { userId, current: { gt: 0 } },
    include: { challenge: { select: { slug: true, title: true } } },
    orderBy: { current: "desc" },
  });
  const today = ctx.now().toISOString().slice(0, 10);
  return rows
    .filter((s) => isStreakAlive({ current: s.current, longest: s.longest, lastActivityDate: s.lastActivityDate?.toISOString().slice(0, 10) ?? null }, today, s.period as StreakPeriod))
    .map((s) => ({ slug: s.challenge.slug, title: s.challenge.title, current: s.current, longest: s.longest, period: s.period }));
}

export interface OnboardingState {
  done: boolean;
  hasAccount: boolean;
  hasActivity: boolean;
  telegram: boolean;
  wallet: boolean;
}

/** Getting-started progress, from what the user has actually done. */
export async function onboardingState(ctx: ServiceContext, userId: string): Promise<OnboardingState> {
  const [u, accounts, joined, created] = await Promise.all([
    ctx.db.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardedAt: true, telegramId: true, walletAddress: true } }),
    ctx.db.connectedAccount.count({ where: { userId, status: "ACTIVE" } }),
    ctx.db.participant.count({ where: { userId } }),
    ctx.db.challenge.count({ where: { creatorId: userId } }),
  ]);
  return { done: !!u.onboardedAt, hasAccount: accounts > 0, hasActivity: joined + created > 0, telegram: u.telegramId !== null, wallet: !!u.walletAddress };
}

/** Finish (or dismiss) getting started. Idempotent. */
export async function completeOnboarding(ctx: ServiceContext, actor: Actor) {
  const r = await ctx.db.user.updateMany({ where: { id: actor.id, onboardedAt: null }, data: { onboardedAt: ctx.now() } });
  if (r.count) await audit(ctx.db, actor.id, "user.onboarded", "User", actor.id);
}
