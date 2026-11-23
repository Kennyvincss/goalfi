import "server-only";
import { prisma } from "@goalfi/db";

export async function userStats(userId: string) {
  const [joined, created, completed, active, approved, streaks, rep] = await Promise.all([
    prisma.participant.count({ where: { userId } }),
    prisma.challenge.count({ where: { creatorId: userId, status: { notIn: ["DRAFT", "CANCELLED"] } } }),
    prisma.participant.count({ where: { userId, status: "COMPLETED" } }),
    prisma.participant.count({ where: { userId, challenge: { status: { in: ["ACTIVE", "UPCOMING"] } } } }),
    prisma.evidence.count({ where: { userId, status: "APPROVED" } }),
    prisma.streak.aggregate({ where: { userId }, _max: { current: true, longest: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { reputationScore: true } }),
  ]);
  return {
    joined, created, completed, active, approved,
    currentStreak: streaks._max.current ?? 0,
    longestStreak: streaks._max.longest ?? 0,
    reputation: rep?.reputationScore ?? 0,
  };
}
