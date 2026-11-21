import { award, canOpenDispute, evidenceStatusAfterDispute, REPUTATION_POINTS } from "@goalfi/core";
import { z } from "zod";
import { requireView } from "./authz";
import { link, type Actor, type ServiceContext } from "./context";
import { conflict, forbidden, invalid, notFound, ServiceError } from "./errors";
import { notify } from "./notifications";
import { applyAwards, applyStreak } from "./reputation";
import { audit } from "./audit";

const OpenSchema = z.object({ reason: z.string().trim().min(10, "Explain the dispute in at least 10 characters").max(2000) });
const RuleSchema = z.object({ ruling: z.enum(["UPHELD", "DISMISSED"]), note: z.string().trim().min(3).max(2000) });

export async function openDispute(ctx: ServiceContext, actor: Actor, evidenceId: string, raw: unknown) {
  const parsed = OpenSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const ev = await ctx.db.evidence.findUnique({ where: { id: evidenceId }, include: { disputes: true } });
  if (!ev) throw notFound("Evidence not found");
  const a = await requireView(ctx.db, ev.challengeId, actor);
  if (["RESOLVING", "RESOLVED", "CANCELLED"].includes(a.challenge.status)) throw conflict("This challenge is already settled");
  // One dispute per submission: an admin ruling is final.
  if (ev.disputes.length > 0) throw conflict("This submission has already been disputed");
  const participants = await ctx.db.participant.findMany({ where: { challengeId: ev.challengeId }, select: { userId: true } });
  const ok = canOpenDispute({
    actorId: actor.id, evidenceOwnerId: ev.userId, participantIds: participants.map((p) => p.userId), evidenceStatus: ev.status,
    decidedAt: ev.decidedAt, disputeWindowHours: a.challenge.disputeWindowHours, existingDisputes: ev.disputes, now: ctx.now(),
  });
  if (!ok.ok) throw new ServiceError(403, ok.reason);
  const dispute = await ctx.db.$transaction(async (tx) => {
    const upd = await tx.evidence.updateMany({ where: { id: ev.id, status: ev.status }, data: { status: "DISPUTED" } });
    if (upd.count === 0) throw conflict("The submission changed, please reload");
    return tx.dispute.create({ data: { evidenceId: ev.id, userId: actor.id, reason: parsed.data.reason } });
  });
  await notify(ctx.db, a.adminIds.filter((id) => id !== actor.id), {
    type: "DISPUTE_OPENED",
    message: `⚖️ @${actor.username} disputed a ${ev.status.toLowerCase()} submission in “${a.challenge.title}”`,
    link: link(ctx, `/challenges/${a.challenge.slug}/review`),
    dedupKey: `DISPUTE_OPENED:${dispute.id}`,
  });
  await audit(ctx.db, actor.id, "dispute.opened", "Dispute", dispute.id, { evidenceId: ev.id, disputed: ev.status });
  return dispute;
}

/** A challenge admin rules on a dispute. The ruling is final and recorded. */
export async function resolveDispute(ctx: ServiceContext, actor: Actor, disputeId: string, raw: unknown) {
  const parsed = RuleSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const d = await ctx.db.dispute.findUnique({ where: { id: disputeId }, include: { evidence: { include: { verifications: true } } } });
  if (!d) throw notFound("Dispute not found");
  const a = await requireView(ctx.db, d.evidence.challengeId, actor);
  if (!a.isAdmin) throw forbidden("Only challenge administrators can rule on disputes");
  if (actor.id === d.userId || actor.id === d.evidence.userId) throw forbidden("You cannot rule on a dispute you are part of");
  if (d.status !== "OPEN" && d.status !== "UNDER_REVIEW") throw conflict("This dispute is already resolved");

  // Status before the dispute = what the verifier votes decided.
  const approvals = d.evidence.verifications.filter((v) => v.decision === "APPROVE").length;
  const disputed: "APPROVED" | "REJECTED" = approvals >= a.challenge.requiredApprovals ? "APPROVED" : "REJECTED";
  const finalStatus = evidenceStatusAfterDispute(disputed, parsed.data.ruling);
  const now = ctx.now();

  await ctx.db.$transaction(async (tx) => {
    const upd = await tx.dispute.updateMany({
      where: { id: d.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
      data: { status: parsed.data.ruling, finalDecision: finalStatus, resolutionNote: parsed.data.note, resolvedById: actor.id, resolvedAt: now },
    });
    if (upd.count === 0) throw conflict("This dispute is already resolved");
    await tx.evidence.update({ where: { id: d.evidenceId }, data: { status: finalStatus, decidedAt: now } });
    if (disputed === "REJECTED" && finalStatus === "APPROVED") {
      await applyAwards(tx, [award(d.evidence.userId, "EVIDENCE_APPROVED", d.evidenceId)]);
      await applyStreak(tx, { userId: d.evidence.userId, challengeId: d.evidence.challengeId, recurrence: a.challenge.recurrence, activityDate: d.evidence.activityDate });
    }
    if (disputed === "APPROVED" && finalStatus === "REJECTED") {
      // Reverse the approval points and penalize the submitter.
      await applyAwards(tx, [{ userId: d.evidence.userId, activity: "PENALTY_EVIDENCE_OVERTURNED", points: REPUTATION_POINTS.PENALTY_EVIDENCE_OVERTURNED, refId: d.evidenceId }]);
    }
  });
  await notify(ctx.db, [d.userId, d.evidence.userId], {
    type: "DISPUTE_RESOLVED",
    message: `⚖️ Dispute in “${a.challenge.title}” ${parsed.data.ruling === "UPHELD" ? "upheld" : "dismissed"}: submission is now ${finalStatus.toLowerCase()}. ${parsed.data.note}`,
    link: link(ctx, `/challenges/${a.challenge.slug}`),
    dedupKey: `DISPUTE_RESOLVED:${d.id}`,
  });
  await audit(ctx.db, actor.id, "dispute.resolved", "Dispute", d.id, { ruling: parsed.data.ruling, finalStatus });
  return { ruling: parsed.data.ruling, finalStatus };
}
