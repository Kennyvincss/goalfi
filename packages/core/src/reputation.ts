/**
 * Reputation rewards meaningful participation only. Trading and spending earn nothing.
 * Points are keyed by (user, activity, refId) in the DB so each is awarded at most once.
 */
export const REPUTATION_POINTS = {
  EVIDENCE_APPROVED: 5,
  CHALLENGE_COMPLETED: 25,
  STREAK_MILESTONE: 10, // per milestone in STREAK_MILESTONES
  CHALLENGE_CREATED_SUCCESSFUL: 15, // challenge resolved with ≥ MIN_PARTICIPANTS_FOR_CREATOR_REWARD participants
  FAIR_VERIFICATION: 2, // vote that matched the final decision (after disputes)
  PENALTY_EVIDENCE_OVERTURNED: -10, // an approval of yours was overturned on dispute
} as const;

export type ReputationActivity = keyof typeof REPUTATION_POINTS;

export const STREAK_MILESTONES = [7, 14, 30, 60, 100, 365] as const;
export const MIN_PARTICIPANTS_FOR_CREATOR_REWARD = 3;

export interface ReputationAward {
  userId: string;
  activity: ReputationActivity;
  points: number;
  refId: string;
}

export function award(userId: string, activity: ReputationActivity, refId: string): ReputationAward {
  return { userId, activity, points: REPUTATION_POINTS[activity], refId };
}

/** Awards for verifiers once an evidence decision is final (no further disputes possible). */
export function verifierAwards(
  evidenceId: string,
  finalStatus: "APPROVED" | "REJECTED",
  votes: { verifierId: string; decision: "APPROVE" | "REJECT" }[],
): ReputationAward[] {
  const want = finalStatus === "APPROVED" ? "APPROVE" : "REJECT";
  return votes.filter((v) => v.decision === want).map((v) => award(v.verifierId, "FAIR_VERIFICATION", evidenceId));
}

/** Awards when a challenge resolves. */
export function resolutionAwards(input: {
  challengeId: string;
  creatorId: string;
  participantCount: number;
  completers: string[];
}): ReputationAward[] {
  const out = input.completers.map((u) => award(u, "CHALLENGE_COMPLETED", input.challengeId));
  if (input.participantCount >= MIN_PARTICIPANTS_FOR_CREATOR_REWARD)
    out.push(award(input.creatorId, "CHALLENGE_CREATED_SUCCESSFUL", input.challengeId));
  return out;
}
