/**
 * Market integrity. Participants control the outcome of their own challenge, so GoalFi limits how
 * much a group can gain by manipulating it: no betting against yourself, market size limits that
 * grow with trust, minimum account age, and anti-farming rules for synced data.
 */
import { appMetric } from "./app-metrics";

const DAY = 86_400_000;

/** Accounts younger than this can't join challenges that have a market, and don't count as community members. */
export const DEFAULT_TRUST_MIN_ACCOUNT_DAYS = 7;
/** Lichess games shorter than this (half-moves) don't count: blocks instant-resign farming. */
export const MIN_CHESS_PLIES = 10;
/** At most this many games against the same opponent count per challenge day. */
export const MAX_EVENTS_PER_OPPONENT_PER_DAY = 3;

export function accountOldEnough(createdAt: Date, now: Date, minDays: number): boolean {
  if (minDays <= 0) return true; // rule switched off
  return now.getTime() - createdAt.getTime() >= minDays * DAY;
}

/** An established member: old enough, and with something that costs effort (wallet, Telegram or reputation). */
export function establishedMember(
  u: { createdAt: Date; walletAddress: string | null; telegramId: bigint | null; reputationScore: number },
  now: Date,
  minDays: number,
): boolean {
  return accountOldEnough(u.createdAt, now, minDays) && (!!u.walletAddress || u.telegramId !== null || u.reputationScore > 0);
}

/** Why a challenge's outcome is easier to manipulate, or null. */
export function easyToGameReason(c: { verificationMethod: string; appMetric: string | null }): string | null {
  return c.verificationMethod === "CONNECTED_APP" ? (appMetric(c.appMetric)?.easyToGame ?? null) : null;
}

export interface MarketLimits {
  /** Max opening liquidity the creator may deposit (USDC). Caps what a manipulating group can take from the pool. */
  maxInitialLiquidityUsdc: number;
  /** Max size of one trade placed through GoalFi (USDC). Protects traders in small, easily influenced markets. */
  maxTradeUsdc: number;
}

/**
 * Limits grow with trust: the creator's reputation for opening liquidity, the number of established
 * participants for trade size. Easier-to-game metrics get a quarter of the standard amounts.
 */
export function marketLimits(p: { easyToGame: boolean; creatorReputation: number; trustedParticipants: number }): MarketLimits {
  const tier = p.creatorReputation >= 100 ? 5 : p.creatorReputation >= 25 ? 2 : 1;
  const base = p.easyToGame ? 25 : 100;
  const perParticipant = p.easyToGame ? 5 : 20;
  return {
    maxInitialLiquidityUsdc: base * tier,
    maxTradeUsdc: Math.min(p.easyToGame ? 100 : 500, perParticipant * (1 + Math.max(0, p.trustedParticipants))),
  };
}

/** Net shares held, from GoalFi-recorded trades. */
export function netShares(p: { sharesBought: bigint; sharesSold: bigint }): bigint {
  return p.sharesBought > p.sharesSold ? p.sharesBought - p.sharesSold : 0n;
}
