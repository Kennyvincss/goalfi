export type EvidenceStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISPUTED";
export type Decision = "APPROVE" | "REJECT";

export interface Vote {
  verifierId: string;
  decision: Decision;
  round: number;
}

export interface TallyResult {
  status: Extract<EvidenceStatus, "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED">;
  approvals: number;
  rejections: number;
  remaining: number;
}

/**
 * Tally votes for the current review round.
 * - APPROVED once approvals reach the threshold.
 * - REJECTED once enough rejections make the threshold unreachable.
 * - Otherwise UNDER_REVIEW (≥1 vote) or PENDING (no votes).
 */
export function tallyVotes(votes: Vote[], round: number, requiredApprovals: number, verifierCount: number): TallyResult {
  if (requiredApprovals < 1) throw new Error("requiredApprovals must be ≥ 1");
  if (verifierCount < requiredApprovals) throw new Error("not enough verifiers to ever reach the threshold");
  const current = votes.filter((v) => v.round === round);
  const seen = new Set<string>();
  let approvals = 0;
  let rejections = 0;
  for (const v of current) {
    if (seen.has(v.verifierId)) continue; // defensive: DB unique constraint already prevents this
    seen.add(v.verifierId);
    if (v.decision === "APPROVE") approvals++;
    else rejections++;
  }
  const remaining = verifierCount - approvals - rejections;
  let status: TallyResult["status"];
  if (approvals >= requiredApprovals) status = "APPROVED";
  else if (approvals + remaining < requiredApprovals) status = "REJECTED";
  else status = approvals + rejections > 0 ? "UNDER_REVIEW" : "PENDING";
  return { status, approvals, rejections, remaining };
}

export interface CanVerifyInput {
  actorId: string;
  verifierIds: string[];
  evidenceOwnerId: string;
  evidenceStatus: EvidenceStatus;
  votes: Vote[];
  round: number;
}

export type Denial = { ok: false; reason: string };
export type Allowed = { ok: true };

export function canVerify(i: CanVerifyInput): Allowed | Denial {
  if (!i.verifierIds.includes(i.actorId)) return { ok: false, reason: "You are not a verifier for this challenge" };
  if (i.actorId === i.evidenceOwnerId) return { ok: false, reason: "You cannot verify your own evidence" };
  if (i.evidenceStatus !== "PENDING" && i.evidenceStatus !== "UNDER_REVIEW")
    return { ok: false, reason: `Evidence is ${i.evidenceStatus.toLowerCase()} and not open for review` };
  if (i.votes.some((v) => v.round === i.round && v.verifierId === i.actorId))
    return { ok: false, reason: "You already reviewed this submission" };
  return { ok: true };
}
