import { evaluateResolution, resolutionAwards, SuccessRuleSchema, verifierAwards, type ResolutionReport } from "@goalfi/core";
import { z } from "zod";
import { requireView } from "./authz";
import { link, type Actor, type ServiceContext } from "./context";
import { conflict, forbidden, invalid, notFound, ServiceError } from "./errors";
import { announceToCommunity, notify } from "./notifications";
import { applyAwards } from "./reputation";
import { audit } from "./audit";

/** Gather DB state for the core resolution gate (actor-independent). */
async function gatherResolutionInput(ctx: ServiceContext, challengeId: string) {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId }, include: { market: true } });
  if (!c) throw notFound("Challenge not found");
  const evidence = await ctx.db.evidence.findMany({
    where: { challengeId },
    select: { id: true, userId: true, status: true, decidedAt: true, progressValue: true, activityDate: true, supersededBy: { select: { id: true } }, disputes: true },
  });
  const participants = await ctx.db.participant.findMany({ where: { challengeId, status: { not: "WITHDRAWN" } }, select: { userId: true } });
  const live = evidence.filter((e) => !e.supersededBy);
  const progress = participants.map((p) => ({
    userId: p.userId,
    approved: live
      .filter((e) => e.userId === p.userId && e.status === "APPROVED")
      .map((e) => ({ progressValue: e.progressValue ? Number(e.progressValue) : null, activityDate: e.activityDate?.toISOString().slice(0, 10) ?? null })),
  }));
  // A market that never made it on-chain can't block resolution forever.
  const marketUsable = c.market && !["CREATING", "FAILED"].includes(c.market.status);
  return {
    now: ctx.now(),
    challenge: { endDate: c.endDate, status: c.status, disputeWindowHours: c.disputeWindowHours, successRule: SuccessRuleSchema.parse(c.successRule) },
    marketEndTs: marketUsable ? c.market!.endTs : null,
    marketStatus: marketUsable ? c.market!.status : null,
    evidence: evidence.map((e) => ({ id: e.id, userId: e.userId, status: e.status, decidedAt: e.decidedAt, superseded: !!e.supersededBy })),
    disputes: evidence.flatMap((e) => e.disputes.map((d) => ({ evidenceId: e.id, status: d.status, resolvedAt: d.resolvedAt }))),
    progress,
  };
}

/** Run the core resolution gate for an actor (blockers + computed outcome). */
export async function resolutionReport(ctx: ServiceContext, actor: Actor, challengeId: string): Promise<ResolutionReport> {
  const a = await requireView(ctx.db, challengeId, actor);
  const input = await gatherResolutionInput(ctx, challengeId);
  return evaluateResolution({ ...input, actor: { id: actor.id, isChallengeAdmin: a.isAdmin, isPlatformAdmin: actor.role === "PLATFORM_ADMIN" } });
}

const ResolveSchema = z.object({
  outcome: z.enum(["YES", "NO"]),
  confirm: z.literal(true),
  /** Platform admins only: required when the chosen outcome differs from the computed one. */
  overrideReason: z.string().trim().min(10).max(1000).optional(),
});

/**
 * The admin confirms the final outcome → resolve on-chain (if there's a market) → finalize.
 * Order of operations guarantees nothing is marked resolved before the chain confirms.
 */
export async function resolveChallenge(ctx: ServiceContext, actor: Actor, challengeId: string, raw: unknown) {
  const parsed = ResolveSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const a = await requireView(ctx.db, challengeId, actor);
  if (!a.isAdmin) throw forbidden("Only challenge administrators can resolve");
  const report = await resolutionReport(ctx, actor, challengeId);
  if (!report.ok) throw new ServiceError(409, "Resolution is blocked", report.blockers);
  const { outcome, overrideReason } = parsed.data;
  if (outcome !== report.proposedOutcome) {
    if (actor.role !== "PLATFORM_ADMIN" || !overrideReason)
      throw conflict(`The verified evidence gives ${report.proposedOutcome} (${report.evaluation.explanation}). Only a platform admin can override, with a reason.`);
  }
  const c = a.challenge;
  const m = c.market && !["CREATING", "FAILED"].includes(c.market.status) ? c.market : null;
  if (c.market && !m) await ctx.db.market.update({ where: { id: c.market.id }, data: { status: "FAILED", lastError: "Never created on-chain; resolved off-chain" } });

  // Lock: only one resolver can move the challenge into RESOLVING.
  const lock = await ctx.db.challenge.updateMany({ where: { id: c.id, status: { in: ["ACTIVE", "IN_REVIEW", "UPCOMING"] } }, data: { status: "RESOLVING" } });
  if (lock.count !== 1) throw conflict("Challenge is already being resolved");
  await audit(ctx.db, actor.id, "challenge.resolve_started", "Challenge", c.id, { outcome, computed: report.proposedOutcome, overrideReason: overrideReason ?? null });

  if (m) {
    const gw = ctx.gateway;
    if (!gw || !m.marketAddress) {
      await ctx.db.challenge.update({ where: { id: c.id }, data: { status: "IN_REVIEW" } });
      throw new ServiceError(503, "Market resolution is not configured on this server");
    }
    await ctx.db.market.update({ where: { id: m.id }, data: { status: "RESOLVING", winningOutcome: outcome === "YES" ? 1 : 2 } });
    try {
      const res = await gw.resolveBinaryMarket({ address: m.marketAddress, side: outcome }, async (sig) => {
        await ctx.db.market.update({ where: { id: m.id }, data: { resolutionSignature: sig } });
      });
      if (res.signature) await ctx.db.market.update({ where: { id: m.id }, data: { resolutionSignature: res.signature } });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      const sent = (await ctx.db.market.findUnique({ where: { id: m.id } }))?.resolutionSignature;
      if (!sent) {
        // Nothing was broadcast: roll back so the admin can retry.
        await ctx.db.market.update({ where: { id: m.id }, data: { status: "CLOSED", winningOutcome: null, lastError: msg } });
        await ctx.db.challenge.update({ where: { id: c.id }, data: { status: "IN_REVIEW" } });
      } else {
        // Broadcast but unconfirmed: stay RESOLVING; the reconciler checks chain state.
        await ctx.db.market.update({ where: { id: m.id }, data: { lastError: msg } });
      }
      throw new ServiceError(502, `On-chain resolution failed: ${msg}`);
    }
  }
  return finalizeResolution(ctx, c.id, outcome, actor.id);
}

/** Write final state, participants, reputation and notifications. Idempotent. */
export async function finalizeResolution(ctx: ServiceContext, challengeId: string, outcome: "YES" | "NO", resolverId: string) {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId }, include: { market: true } });
  if (!c) throw notFound();
  if (c.status === "RESOLVED") return c;
  const report = await resolutionReportInternal(ctx, challengeId);
  const now = ctx.now();
  const participants = await ctx.db.participant.findMany({ where: { challengeId, status: { not: "WITHDRAWN" } }, select: { userId: true } });
  const evidence = await ctx.db.evidence.findMany({ where: { challengeId, status: { in: ["APPROVED", "REJECTED"] }, supersededBy: null }, include: { verifications: true } });

  const resolved = await ctx.db.$transaction(async (tx) => {
    const upd = await tx.challenge.updateMany({
      where: { id: challengeId, status: "RESOLVING" },
      data: { status: "RESOLVED", outcome, resolvedAt: now, resolvedById: resolverId, resultSummary: report as object },
    });
    if (upd.count !== 1) return null;
    if (c.market && c.market.status !== "FAILED")
      await tx.market.update({ where: { id: c.market.id }, data: { status: "RESOLVED", winningOutcome: outcome === "YES" ? 1 : 2, resolvedAt: now, resolvedById: resolverId } });
    const completers = new Set(report.completers);
    for (const p of participants)
      await tx.participant.update({
        where: { challengeId_userId: { challengeId, userId: p.userId } },
        data: completers.has(p.userId) ? { status: "COMPLETED", completedAt: now } : { status: "FAILED" },
      });
    await applyAwards(tx, [
      ...resolutionAwards({ challengeId, creatorId: c.creatorId, participantCount: participants.length, completers: report.completers }),
      ...evidence.flatMap((e) => verifierAwards(e.id, e.status as "APPROVED" | "REJECTED", e.verifications)),
    ]);
    return true;
  });
  if (!resolved) return ctx.db.challenge.findUniqueOrThrow({ where: { id: challengeId } });

  const url = link(ctx, `/challenges/${c.slug}`);
  await notify(ctx.db, participants.map((p) => p.userId), {
    type: "CHALLENGE_RESOLVED", message: `🏁 “${c.title}” resolved: ${outcome === "YES" ? "goal achieved" : "goal not achieved"}`, link: url, dedupKey: `RESOLVED:${c.id}`,
  });
  if (c.market) {
    const winners = await ctx.db.position.findMany({ where: { marketId: c.market.id, outcome: outcome === "YES" ? 1 : 2 }, select: { userId: true } });
    await notify(ctx.db, winners.map((w) => w.userId), {
      type: "WINNINGS_AVAILABLE", message: `💰 You hold winning ${outcome} shares in “${c.title}”. Claim your USDC.`, link: url, dedupKey: `WINNINGS:${c.id}`,
    });
  }
  await announceToCommunity(ctx.db, c.communityId, {
    text: `🏁 Challenge resolved: ${c.title}\nResult: ${outcome === "YES" ? "✅ goal achieved" : "❌ goal not achieved"}\n${report.explanation}`,
    buttons: [{ text: "See results", url }],
    dedupKey: `ANNOUNCE_RESOLVED:${c.id}`,
  });
  return ctx.db.challenge.findUniqueOrThrow({ where: { id: challengeId } });
}

async function resolutionReportInternal(ctx: ServiceContext, challengeId: string) {
  const input = await gatherResolutionInput(ctx, challengeId);
  const e = evaluateResolution({ ...input, actor: { id: "system", isChallengeAdmin: true, isPlatformAdmin: false } }).evaluation;
  return { explanation: e.explanation, value: e.value, target: e.target, achieved: e.achieved, completers: e.completers };
}

/** Reconciler: finish resolutions whose tx was sent but not confirmed when the request ended. */
export async function reconcileResolutions(ctx: ServiceContext): Promise<number> {
  const gw = ctx.gateway;
  if (!gw) return 0;
  const stuck = await ctx.db.market.findMany({ where: { status: "RESOLVING", marketAddress: { not: null } }, include: { challenge: true } });
  let done = 0;
  for (const m of stuck) {
    const state = await gw.fetchMarket(m.marketAddress!).catch(() => null);
    if (state?.resolved && m.winningOutcome && m.challenge.resolvedById === null && m.challenge.status === "RESOLVING") {
      const resolver = (await ctx.db.auditLog.findFirst({ where: { entityId: m.challengeId, action: "challenge.resolve_started" }, orderBy: { createdAt: "desc" } }))?.actorId ?? m.challenge.creatorId;
      await finalizeResolution(ctx, m.challengeId, m.winningOutcome === 1 ? "YES" : "NO", resolver);
      done++;
    }
  }
  return done;
}
