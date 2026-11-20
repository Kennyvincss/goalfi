import type { Prisma } from "@goalfi/db";
import type { Actor, ServiceContext } from "./context";
import { forbidden, notFound } from "./errors";

type Db = ServiceContext["db"] | Prisma.TransactionClient;

export interface ChallengeAccess {
  challenge: Prisma.ChallengeGetPayload<{ include: { roles: true; market: true } }>;
  isCreator: boolean;
  isAdmin: boolean;
  isVerifier: boolean;
  isParticipant: boolean;
  isCommunityMember: boolean;
  canView: boolean;
  verifierIds: string[];
  adminIds: string[];
}

/** Resolve everything an actor may do on a challenge. Admin = creator, challenge ADMIN, community OWNER/ADMIN, platform admin. */
export async function challengeAccess(db: Db, challengeId: string, actor: Actor | null): Promise<ChallengeAccess> {
  const challenge = await db.challenge.findUnique({ where: { id: challengeId }, include: { roles: true, market: true } });
  if (!challenge) throw notFound("Challenge not found");
  const uid = actor?.id ?? null;
  const verifierIds = challenge.roles.filter((r) => r.role === "VERIFIER").map((r) => r.userId);
  const adminIds = [...new Set([challenge.creatorId, ...challenge.roles.filter((r) => r.role === "ADMIN").map((r) => r.userId)])];
  let communityRole: string | null = null;
  if (uid && challenge.communityId) {
    const m = await db.communityMember.findUnique({ where: { communityId_userId: { communityId: challenge.communityId, userId: uid } } });
    communityRole = m?.role ?? null;
  }
  const isParticipant = uid ? !!(await db.participant.findUnique({ where: { challengeId_userId: { challengeId, userId: uid } } })) : false;
  const isCreator = uid === challenge.creatorId;
  const isAdmin = !!uid && (adminIds.includes(uid) || communityRole === "OWNER" || communityRole === "ADMIN" || actor?.role === "PLATFORM_ADMIN");
  const isVerifier = !!uid && verifierIds.includes(uid);
  const isCommunityMember = communityRole !== null;
  // Not public until launched: drafts and markets still being created/funded are hidden.
  const published = challenge.status !== "DRAFT" && challenge.status !== "PENDING_MARKET";
  const canView =
    isAdmin || isVerifier || isParticipant ||
    (published && (challenge.visibility === "PUBLIC" || (challenge.visibility === "COMMUNITY" && isCommunityMember)));
  return { challenge, isCreator, isAdmin, isVerifier, isParticipant, isCommunityMember, canView, verifierIds, adminIds };
}

export async function requireView(db: Db, challengeId: string, actor: Actor | null): Promise<ChallengeAccess> {
  const a = await challengeAccess(db, challengeId, actor);
  if (!a.canView) throw notFound("Challenge not found"); // don't leak existence of private challenges
  return a;
}

export async function requireAdmin(db: Db, challengeId: string, actor: Actor): Promise<ChallengeAccess> {
  const a = await requireView(db, challengeId, actor);
  if (!a.isAdmin) throw forbidden("Only challenge administrators can do that");
  return a;
}
