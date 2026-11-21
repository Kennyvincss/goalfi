import { z } from "zod";

/**
 * Machine-checkable success criteria. Every challenge stores one of these next to its
 * human-readable `successCriteria` text, so the final outcome is computed from approved
 * evidence rather than typed in by hand.
 */
export const SuccessRuleSchema = z.discriminatedUnion("type", [
  // "At least 15 participants must individually complete 100 km."
  z.object({
    type: z.literal("individual_threshold"),
    unit: z.string().min(1).max(32),
    threshold: z.number().positive(),
    minParticipants: z.number().int().min(1),
  }),
  // "The community collectively runs 1,500 km."
  z.object({
    type: z.literal("collective_total"),
    unit: z.string().min(1).max(32),
    target: z.number().positive(),
  }),
  // "Walk 10,000 steps every day for 30 days" — approved evidence on N distinct days.
  z.object({
    type: z.literal("daily_completion"),
    requiredDays: z.number().int().min(1).max(366),
    minParticipants: z.number().int().min(1),
  }),
  // Milestone: "Launch a website" — at least N participants have ≥1 approved submission.
  z.object({
    type: z.literal("milestone"),
    minCompleters: z.number().int().min(1),
  }),
]);
export type SuccessRule = z.infer<typeof SuccessRuleSchema>;

/** Approved evidence for one participant, as needed by the rule evaluator. */
export interface ParticipantProgress {
  userId: string;
  approved: { progressValue: number | null; activityDate: string | null }[];
}

export interface RuleEvaluation {
  achieved: boolean;
  /** Participant user ids who individually met the per-participant bar (if the rule has one). */
  completers: string[];
  /** Headline metric, e.g. total km or number of completers. */
  value: number;
  target: number;
  explanation: string;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function evaluateSuccessRule(rule: SuccessRule, progress: ParticipantProgress[]): RuleEvaluation {
  switch (rule.type) {
    case "individual_threshold": {
      const completers = progress
        .filter((p) => sum(p.approved.map((e) => e.progressValue ?? 0)) >= rule.threshold)
        .map((p) => p.userId);
      return {
        achieved: completers.length >= rule.minParticipants,
        completers,
        value: completers.length,
        target: rule.minParticipants,
        explanation: `${completers.length} of ${rule.minParticipants} required participants reached ${rule.threshold} ${rule.unit}`,
      };
    }
    case "collective_total": {
      const total = sum(progress.flatMap((p) => p.approved.map((e) => e.progressValue ?? 0)));
      return {
        achieved: total >= rule.target,
        completers: [],
        value: total,
        target: rule.target,
        explanation: `Community total ${total} / ${rule.target} ${rule.unit}`,
      };
    }
    case "daily_completion": {
      const completers = progress
        .filter((p) => new Set(p.approved.map((e) => e.activityDate).filter(Boolean)).size >= rule.requiredDays)
        .map((p) => p.userId);
      return {
        achieved: completers.length >= rule.minParticipants,
        completers,
        value: completers.length,
        target: rule.minParticipants,
        explanation: `${completers.length} of ${rule.minParticipants} required participants completed ${rule.requiredDays} days`,
      };
    }
    case "milestone": {
      const completers = progress.filter((p) => p.approved.length > 0).map((p) => p.userId);
      return {
        achieved: completers.length >= rule.minCompleters,
        completers,
        value: completers.length,
        target: rule.minCompleters,
        explanation: `${completers.length} of ${rule.minCompleters} required participants reached the milestone`,
      };
    }
  }
}

/** Live progress (0..1) toward the rule's target, for progress bars. */
export function progressFraction(evaluation: RuleEvaluation): number {
  if (evaluation.target <= 0) return 0;
  return Math.max(0, Math.min(1, evaluation.value / evaluation.target));
}
