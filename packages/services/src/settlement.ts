import { reviewDeadline } from "@goalfi/core";
import { link, type ServiceContext } from "./context";
import { notify } from "./notifications";
import { executeResolution, systemResolutionReport } from "./resolution";
import { audit } from "./audit";

export const REVIEW_DEADLINE_DECISION = "REVIEW_DEADLINE";
const HOUR = 3_600_000;

/**
 * Review deadline: evidence not approved by `endDate + reviewDeadlineHours` counts as rejected.
 * That includes partially reviewed evidence (threshold not reached). The submitter can still
 * dispute within the dispute window.
 */
export async function applyReviewDeadlines(ctx: ServiceContext): Promise<number> {
  const now = ctx.now();
  const open = await ctx.db.evidence.findMany({
    where: {
      status: { in: ["PENDING", "UNDER_REVIEW"] },
      supersededBy: null,
      challenge: { reviewDeadlineHours: { not: null }, status: { in: ["ACTIVE", "IN_REVIEW"] }, endDate: { lt: now } },
    },
    include: { challenge: { select: { id: true, slug: true, title: true, endDate: true, reviewDeadlineHours: true, disputeWindowHours: true } } },
  });
  let rejected = 0;
  for (const e of open) {
    const deadline = reviewDeadline(e.challenge.endDate, e.challenge.reviewDeadlineHours);
    if (!deadline || deadline > now) continue;
    // Conditional update: a verifier deciding at the same moment wins.
    const r = await ctx.db.evidence.updateMany({
      where: { id: e.id, status: { in: ["PENDING", "UNDER_REVIEW"] } },
      data: { status: "REJECTED", decidedAt: now, autoDecision: REVIEW_DEADLINE_DECISION },
    });
    if (r.count !== 1) continue;
    rejected++;
    await notify(ctx.db, [e.userId], {
      type: "EVIDENCE_REJECTED",
      message: `Your evidence for “${e.challenge.title}” wasn’t approved before the review deadline, so it counts as rejected. You can dispute this within ${e.challenge.disputeWindowHours}h.`,
      link: link(ctx, `/challenges/${e.challenge.slug}`),
      dedupKey: `EVIDENCE_DECIDED:${e.id}`,
    });
  }
  return rejected;
}

/** Warn verifiers once when a review deadline is within 12 hours and submissions are still open. */
export async function reviewDeadlineReminders(ctx: ServiceContext): Promise<number> {
  const now = ctx.now();
  const challenges = await ctx.db.challenge.findMany({
    where: { reviewDeadlineHours: { not: null }, status: { in: ["ACTIVE", "IN_REVIEW"] }, endDate: { lt: new Date(now.getTime() + 12 * HOUR) } },
    select: {
      id: true, slug: true, title: true, endDate: true, reviewDeadlineHours: true,
      roles: { where: { role: "VERIFIER" }, select: { userId: true } },
      _count: { select: { evidence: { where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, supersededBy: null } } } },
    },
  });
  let sent = 0;
  for (const c of challenges) {
    const deadline = reviewDeadline(c.endDate, c.reviewDeadlineHours)!;
    const left = deadline.getTime() - now.getTime();
    if (c._count.evidence === 0 || left <= 0 || left > 12 * HOUR) continue;
    sent += await notify(ctx.db, c.roles.map((r) => r.userId), {
      type: "EVIDENCE_RECEIVED",
      message: `⏳ ${c._count.evidence} submission(s) in “${c.title}” still need review. Anything not approved within ${Math.ceil(left / HOUR)}h counts as rejected.`,
      link: link(ctx, `/challenges/${c.slug}/review`),
      dedupKey: `REVIEW_DEADLINE_SOON:${c.id}`,
    });
  }
  return sent;
}

/**
 * Auto-settlement: for challenges created with "settle automatically", resolve with the computed
 * outcome as soon as the resolution gate has no blockers (ended, everything reviewed, no open
 * disputes, dispute window over). Uses the same path as the admin button.
 */
export async function autoSettleTick(ctx: ServiceContext) {
  const now = ctx.now();
  const candidates = await ctx.db.challenge.findMany({
    where: { autoSettle: true, status: { in: ["IN_REVIEW", "ACTIVE"] }, endDate: { lt: now } },
    select: { id: true, title: true },
    take: 20,
  });
  const out = { settled: 0, waiting: 0, failed: 0 };
  for (const c of candidates) {
    const report = await systemResolutionReport(ctx, c.id);
    if (!report.ok) {
      out.waiting++;
      continue;
    }
    try {
      await executeResolution(ctx, c.id, report.proposedOutcome, null, { automatic: true, computed: report.proposedOutcome, explanation: report.evaluation.explanation });
      out.settled++;
    } catch (e) {
      out.failed++;
      console.error(`[auto-settle] ${c.title}:`, (e as Error).message);
      await audit(ctx.db, null, "challenge.auto_resolve_failed", "Challenge", c.id, { error: (e as Error).message.slice(0, 300) });
    }
  }
  return out;
}
