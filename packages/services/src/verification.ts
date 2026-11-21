import { award, canVerify, tallyVotes } from "@goalfi/core";
import { z } from "zod";
import { requireView } from "./authz";
import { link, type Actor, type ServiceContext } from "./context";
import { conflict, invalid, isUniqueViolation, notFound, ServiceError } from "./errors";
import { notify } from "./notifications";
import { applyAwards, applyStreak } from "./reputation";

export const ReviewSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(1000).optional() })
  .refine((r) => r.decision === "APPROVE" || (r.reason && r.reason.length >= 3), { message: "A reason is required when rejecting", path: ["reason"] });

/** A verifier approves or rejects a submission. Threshold logic lives in @goalfi/core tallyVotes. */
export async function reviewEvidence(ctx: ServiceContext, actor: Actor, evidenceId: string, raw: unknown) {
  const parsed = ReviewSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const { decision, reason } = parsed.data;
  const ev = await ctx.db.evidence.findUnique({ where: { id: evidenceId }, include: { verifications: true, supersededBy: { select: { id: true } } } });
  if (!ev) throw notFound("Evidence not found");
  const a = await requireView(ctx.db, ev.challengeId, actor);
  if (ev.supersededBy) throw conflict("This submission was replaced by a newer one");
  if (!["ACTIVE", "IN_REVIEW"].includes(a.challenge.status)) throw conflict("This challenge is not in a reviewable state");
  const round = 0;
  const votes = ev.verifications.map((v) => ({ verifierId: v.verifierId, decision: v.decision, round: v.round }));
  const allowed = canVerify({ actorId: actor.id, verifierIds: a.verifierIds, evidenceOwnerId: ev.userId, evidenceStatus: ev.status, votes, round });
  if (!allowed.ok) throw new ServiceError(403, allowed.reason);

  const result = await ctx.db.$transaction(async (tx) => {
    try {
      await tx.verification.create({ data: { evidenceId, verifierId: actor.id, decision, reason: reason ?? null, round } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("You already reviewed this submission");
      throw e;
    }
    const all = await tx.verification.findMany({ where: { evidenceId, round } });
    const tally = tallyVotes(all.map((v) => ({ verifierId: v.verifierId, decision: v.decision, round: v.round })), round, a.challenge.requiredApprovals, a.verifierIds.length);
    const final = tally.status === "APPROVED" || tally.status === "REJECTED";
    // Conditional update: only move forward from an open state (guards against concurrent finalization).
    const upd = await tx.evidence.updateMany({
      where: { id: evidenceId, status: { in: ["PENDING", "UNDER_REVIEW"] } },
      data: { status: tally.status, ...(final ? { decidedAt: ctx.now() } : {}) },
    });
    if (upd.count === 0) throw conflict("This submission was already decided");
    if (tally.status === "APPROVED") {
      await applyAwards(tx, [award(ev.userId, "EVIDENCE_APPROVED", ev.id)]);
      await applyStreak(tx, { userId: ev.userId, challengeId: ev.challengeId, recurrence: a.challenge.recurrence, activityDate: ev.activityDate });
    }
    return tally;
  });

  if (result.status === "APPROVED" || result.status === "REJECTED") {
    await notify(ctx.db, [ev.userId], {
      type: result.status === "APPROVED" ? "EVIDENCE_APPROVED" : "EVIDENCE_REJECTED",
      message:
        result.status === "APPROVED"
          ? `✅ Your evidence for “${a.challenge.title}” was approved`
          : `❌ Your evidence for “${a.challenge.title}” was rejected. You can dispute within ${a.challenge.disputeWindowHours}h.`,
      link: link(ctx, `/challenges/${a.challenge.slug}`),
      dedupKey: `EVIDENCE_DECIDED:${evidenceId}`,
    });
  }
  return result;
}

/** Review queue for a verifier: open submissions they haven't voted on yet. */
export async function reviewQueue(ctx: ServiceContext, actor: Actor, challengeId?: string) {
  return ctx.db.evidence.findMany({
    where: {
      ...(challengeId ? { challengeId } : {}),
      status: { in: ["PENDING", "UNDER_REVIEW"] },
      supersededBy: null,
      userId: { not: actor.id },
      challenge: { roles: { some: { userId: actor.id, role: "VERIFIER" } }, status: { in: ["ACTIVE", "IN_REVIEW"] } },
      verifications: { none: { verifierId: actor.id } },
    },
    orderBy: { submittedAt: "asc" },
    include: {
      challenge: { select: { id: true, slug: true, title: true, requiredApprovals: true, successRule: true, evidenceReq: true } },
      user: { select: { username: true } },
      files: { select: { id: true, mimeType: true, sizeBytes: true } },
      verifications: { select: { decision: true } },
    },
  });
}
