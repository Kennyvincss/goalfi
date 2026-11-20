import { applyActivity, award, type ReputationAward, type StreakPeriod } from "@goalfi/core";
import type { Prisma } from "@goalfi/db";
import { notify } from "./notifications";

/**
 * Apply reputation awards idempotently: each (user, activity, refId) is recorded at most once,
 * and the user's score moves only when a new event is actually inserted.
 */
export async function applyAwards(tx: Prisma.TransactionClient, awards: ReputationAward[]): Promise<number> {
  let applied = 0;
  for (const a of awards) {
    const r = await tx.reputationEvent.createMany({
      data: [{ userId: a.userId, activityType: a.activity, points: a.points, refId: a.refId }],
      skipDuplicates: true,
    });
    if (r.count === 1) {
      await tx.user.update({ where: { id: a.userId }, data: { reputationScore: { increment: a.points } } });
      applied++;
    }
  }
  return applied;
}

const PERIOD: Record<string, StreakPeriod | undefined> = { DAILY: "DAILY", WEEKLY: "WEEKLY", MONTHLY: "MONTHLY" };

/** Advance the participant's streak for a recurring challenge after an approval. */
export async function applyStreak(
  tx: Prisma.TransactionClient,
  p: { userId: string; challengeId: string; recurrence: string; activityDate: Date | null },
): Promise<void> {
  const period = PERIOD[p.recurrence];
  if (!period || !p.activityDate) return;
  const iso = p.activityDate.toISOString().slice(0, 10);
  const prev = await tx.streak.findUnique({ where: { userId_challengeId: { userId: p.userId, challengeId: p.challengeId } } });
  const state = { current: prev?.current ?? 0, longest: prev?.longest ?? 0, lastActivityDate: prev?.lastActivityDate?.toISOString().slice(0, 10) ?? null };
  const up = applyActivity(state, iso, period);
  if (!up.counted) return;
  const data = { current: up.state.current, longest: up.state.longest, lastActivityDate: new Date(`${iso}T00:00:00Z`), period };
  await tx.streak.upsert({
    where: { userId_challengeId: { userId: p.userId, challengeId: p.challengeId } },
    update: data,
    create: { userId: p.userId, challengeId: p.challengeId, ...data },
  });
  for (const m of up.milestonesReached) {
    await applyAwards(tx, [award(p.userId, "STREAK_MILESTONE", `${p.challengeId}:${m}`)]);
    await notify(tx, [p.userId], { type: "STREAK_REMINDER", message: `🔥 ${m}-period streak! Keep it going.`, dedupKey: `STREAK:${p.challengeId}:${m}` });
  }
}
