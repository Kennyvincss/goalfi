export type ChallengeStatus =
  | "DRAFT"
  | "PENDING_MARKET"
  | "UPCOMING"
  | "ACTIVE"
  | "IN_REVIEW"
  | "RESOLVING"
  | "RESOLVED"
  | "SUSPENDED"
  | "CANCELLED";

/**
 * Time-driven status transitions, applied by the scheduler. Manual transitions
 * (confirm, suspend, resolve) are handled by explicit API actions.
 */
export function timeTransition(
  status: ChallengeStatus,
  startDate: Date,
  endDate: Date,
  now: Date,
): ChallengeStatus | null {
  if (status === "UPCOMING" && now >= startDate) return now >= endDate ? "IN_REVIEW" : "ACTIVE";
  if (status === "ACTIVE" && now >= endDate) return "IN_REVIEW";
  return null;
}

/** Status a confirmed challenge is published with, once its market (if any) is ready. */
export function publishedStatus(startDate: Date, now: Date): ChallengeStatus {
  return now >= startDate ? "ACTIVE" : "UPCOMING";
}

export function canJoin(status: ChallengeStatus): boolean {
  return status === "UPCOMING" || status === "ACTIVE";
}

export function canSubmitEvidence(status: ChallengeStatus, now: Date, startDate: Date, endDate: Date, graceHours = 24): boolean {
  if (status !== "ACTIVE" && status !== "IN_REVIEW") return false;
  // Evidence for the final day may arrive shortly after the end date.
  return now >= startDate && now.getTime() <= endDate.getTime() + graceHours * 3_600_000;
}
