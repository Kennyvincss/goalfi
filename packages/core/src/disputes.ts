import type { Allowed, Denial, EvidenceStatus } from "./verification";

export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "UPHELD" | "DISMISSED";

export interface CanDisputeInput {
  actorId: string;
  evidenceOwnerId: string;
  participantIds: string[];
  evidenceStatus: EvidenceStatus;
  decidedAt: Date | null;
  disputeWindowHours: number;
  existingDisputes: { status: DisputeStatus }[];
  now: Date;
}

/**
 * Who can dispute what:
 * - The evidence owner can dispute a REJECTION.
 * - Any other participant can dispute an APPROVAL (it may affect the outcome).
 * Disputes must be opened within the challenge's dispute window after the decision,
 * and only one open dispute per evidence at a time.
 */
export function canOpenDispute(i: CanDisputeInput): Allowed | Denial {
  if (i.evidenceStatus !== "APPROVED" && i.evidenceStatus !== "REJECTED")
    return { ok: false, reason: "Only decided evidence can be disputed" };
  if (i.evidenceStatus === "REJECTED" && i.actorId !== i.evidenceOwnerId)
    return { ok: false, reason: "Only the submitter can dispute a rejection" };
  if (i.evidenceStatus === "APPROVED") {
    if (i.actorId === i.evidenceOwnerId) return { ok: false, reason: "You cannot dispute your own approval" };
    if (!i.participantIds.includes(i.actorId)) return { ok: false, reason: "Only participants can dispute an approval" };
  }
  if (!i.decidedAt) return { ok: false, reason: "Evidence has no decision yet" };
  const closes = i.decidedAt.getTime() + i.disputeWindowHours * 3_600_000;
  if (i.now.getTime() > closes) return { ok: false, reason: "The dispute window has closed" };
  if (i.existingDisputes.some((d) => d.status === "OPEN" || d.status === "UNDER_REVIEW"))
    return { ok: false, reason: "A dispute is already open for this evidence" };
  return { ok: true };
}

/** Final evidence status after an admin rules on a dispute. */
export function evidenceStatusAfterDispute(
  disputedStatus: Extract<EvidenceStatus, "APPROVED" | "REJECTED">,
  ruling: Extract<DisputeStatus, "UPHELD" | "DISMISSED">,
): Extract<EvidenceStatus, "APPROVED" | "REJECTED"> {
  if (ruling === "DISMISSED") return disputedStatus;
  return disputedStatus === "APPROVED" ? "REJECTED" : "APPROVED";
}
