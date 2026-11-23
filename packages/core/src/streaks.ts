import { STREAK_MILESTONES } from "./reputation";

export type StreakPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

export interface StreakState {
  current: number;
  longest: number;
  /** ISO date (YYYY-MM-DD, UTC) of the last counted activity. */
  lastActivityDate: string | null;
}

const DAY = 86_400_000;

function toUtcDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date ${iso}`);
  return d;
}

/** Index of the period an ISO date falls in (days since epoch / ISO-week / month count). */
export function periodIndex(iso: string, period: StreakPeriod): number {
  const d = toUtcDate(iso);
  switch (period) {
    case "DAILY":
      return Math.floor(d.getTime() / DAY);
    case "WEEKLY":
      // 1970-01-01 was a Thursday; shift so weeks start Monday.
      return Math.floor((d.getTime() / DAY + 3) / 7);
    case "MONTHLY":
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
}

export interface StreakUpdate {
  state: StreakState;
  /** Milestones newly crossed by this update (for reputation + notifications). */
  milestonesReached: number[];
  counted: boolean;
}

/**
 * Apply an approved activity on `activityDate` to a streak.
 * - Same period as last activity: no change (already counted).
 * - Next consecutive period: +1.
 * - Gap: reset to 1.
 * - Older than last activity (late approval of a past day): ignored for the live streak.
 */
export function applyActivity(prev: StreakState, activityDate: string, period: StreakPeriod): StreakUpdate {
  const idx = periodIndex(activityDate, period);
  if (prev.lastActivityDate) {
    const last = periodIndex(prev.lastActivityDate, period);
    if (idx <= last) return { state: prev, milestonesReached: [], counted: false };
    const current = idx === last + 1 ? prev.current + 1 : 1;
    const longest = Math.max(prev.longest, current);
    const milestonesReached = STREAK_MILESTONES.filter((m) => current >= m && prev.current < m);
    return { state: { current, longest, lastActivityDate: activityDate }, milestonesReached, counted: true };
  }
  const state = { current: 1, longest: Math.max(prev.longest, 1), lastActivityDate: activityDate };
  return { state, milestonesReached: [], counted: true };
}

/** A streak is "alive" if the user can still extend it today (no missed period). */
export function isStreakAlive(s: StreakState, todayIso: string, period: StreakPeriod): boolean {
  if (!s.lastActivityDate || s.current === 0) return false;
  return periodIndex(todayIso, period) - periodIndex(s.lastActivityDate, period) <= 1;
}
