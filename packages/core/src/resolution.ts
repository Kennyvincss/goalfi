import { evaluateSuccessRule, type ParticipantProgress, type RuleEvaluation, type SuccessRule } from "./success-rule";
import type { DisputeStatus } from "./disputes";
import type { EvidenceStatus } from "./verification";

export interface ResolutionInput {
  now: Date;
  challenge: {
    endDate: Date;
    status: string;
    disputeWindowHours: number;
    successRule: SuccessRule;
  };
  /** Market end_ts (trading close). Resolution on-chain requires end_ts to have passed. */
  marketEndTs: Date | null;
  marketStatus: string | null;
  evidence: { id: string; userId: string; status: EvidenceStatus; decidedAt: Date | null; superseded: boolean }[];
  disputes: { evidenceId: string; status: DisputeStatus; resolvedAt: Date | null }[];
  progress: ParticipantProgress[];
  actor: { id: string; isChallengeAdmin: boolean; isPlatformAdmin: boolean };
}

export interface ResolutionReport {
  ok: boolean;
  blockers: string[];
  evaluation: RuleEvaluation;
  proposedOutcome: "YES" | "NO";
}

/**
 * GoalFi's resolution gate. The pm-AMM program only checks "authority signed, end_ts passed".
 * Everything about human verification is enforced here, before the backend will sign
 * `resolve_market`.
 */
export function evaluateResolution(i: ResolutionInput): ResolutionReport {
  const blockers: string[] = [];
  const now = i.now.getTime();

  if (!i.actor.isChallengeAdmin && !i.actor.isPlatformAdmin) blockers.push("Only a challenge administrator can resolve");
  if (["RESOLVED", "RESOLVING"].includes(i.challenge.status)) blockers.push("Challenge is already resolved or resolving");
  if (i.challenge.status === "CANCELLED") blockers.push("Challenge was cancelled");
  if (now < i.challenge.endDate.getTime()) blockers.push("Challenge has not ended yet");
  if (i.marketEndTs && now < i.marketEndTs.getTime()) blockers.push("Market trading period has not closed yet");
  if (i.marketStatus && ["CREATING", "RESOLVING", "RESOLVED", "FAILED"].includes(i.marketStatus))
    blockers.push(`Market is ${i.marketStatus.toLowerCase()}`);

  const live = i.evidence.filter((e) => !e.superseded);
  const unreviewed = live.filter((e) => e.status === "PENDING" || e.status === "UNDER_REVIEW");
  if (unreviewed.length > 0) blockers.push(`${unreviewed.length} submission(s) still awaiting verification`);

  const openDisputes = i.disputes.filter((d) => d.status === "OPEN" || d.status === "UNDER_REVIEW");
  if (openDisputes.length > 0) blockers.push(`${openDisputes.length} dispute(s) still open`);
  const disputed = live.filter((e) => e.status === "DISPUTED");
  if (disputed.length > 0 && openDisputes.length === 0) blockers.push(`${disputed.length} submission(s) marked disputed`);

  // The dispute window must have elapsed after the latest decision, so nobody loses the right to dispute.
  const windowMs = i.challenge.disputeWindowHours * 3_600_000;
  const lastDecision = Math.max(
    0,
    ...live.map((e) => e.decidedAt?.getTime() ?? 0),
    ...i.disputes.map((d) => d.resolvedAt?.getTime() ?? 0),
  );
  if (lastDecision > 0 && now < lastDecision + windowMs) {
    const hrs = Math.ceil((lastDecision + windowMs - now) / 3_600_000);
    blockers.push(`Dispute window still open (~${hrs}h remaining)`);
  }

  const evaluation = evaluateSuccessRule(i.challenge.successRule, i.progress);
  return { ok: blockers.length === 0, blockers, evaluation, proposedOutcome: evaluation.achieved ? "YES" : "NO" };
}
