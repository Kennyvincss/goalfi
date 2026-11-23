import "server-only";
import { prisma, type Prisma } from "@goalfi/db";

/** Visibility filter: what a viewer (or anonymous visitor) may see. */
export function visibleChallengesWhere(viewerId: string | null): Prisma.ChallengeWhereInput {
  // Drafts and challenges whose market is still being created/funded are not public yet.
  const published: Prisma.ChallengeWhereInput = { status: { notIn: ["DRAFT", "PENDING_MARKET"] } };
  if (!viewerId) return { ...published, visibility: "PUBLIC" };
  return {
    ...published,
    OR: [
      { visibility: "PUBLIC" },
      { creatorId: viewerId },
      { roles: { some: { userId: viewerId } } },
      { participants: { some: { userId: viewerId } } },
      { visibility: "COMMUNITY", community: { members: { some: { userId: viewerId } } } },
    ],
  };
}

export const challengeCardInclude = {
  category: { select: { slug: true, name: true, icon: true } },
  community: { select: { slug: true, name: true } },
  _count: { select: { participants: true } },
  market: {
    select: {
      id: true, status: true, marketAddress: true, marketType: true, endTs: true, liquidity: true,
      snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { yesPrice: true, takenAt: true } },
    },
  },
} satisfies Prisma.ChallengeInclude;

export type ChallengeCardData = Prisma.ChallengeGetPayload<{ include: typeof challengeCardInclude }> & { volumeMicro?: bigint };

/** Confirmed GoalFi-routed swap volume per market (micro-units of collateral in). */
/**
 * Confirmed GoalFi-routed volume per market, in collateral micro-units:
 * buys count the collateral paid in (`amount`), sells the collateral received (`outputAmount`).
 */
export async function volumes(marketIds: string[]): Promise<Map<string, bigint>> {
  if (marketIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ marketId: string; volume: bigint }[]>`
    SELECT "market_id" AS "marketId",
           COALESCE(SUM(CASE WHEN "transaction_type" IN ('BUY_YES','BUY_NO') THEN "amount" ELSE COALESCE("outputAmount", 0) END), 0)::bigint AS volume
    FROM "transactions"
    WHERE "status" = 'CONFIRMED' AND "transaction_type" IN ('BUY_YES','BUY_NO','SELL_YES','SELL_NO') AND "market_id" = ANY(${marketIds})
    GROUP BY "market_id"`;
  return new Map(rows.map((r) => [r.marketId, BigInt(r.volume)]));
}

export type ChallengeSort = "trending" | "new" | "ending" | "participants" | "markets" | "volume" | "liquidity";

export async function listChallenges(opts: {
  viewerId: string | null;
  category?: string;
  q?: string;
  sort?: ChallengeSort;
  take?: number;
  onlyWithMarkets?: boolean;
}): Promise<ChallengeCardData[]> {
  const where: Prisma.ChallengeWhereInput = {
    AND: [
      visibleChallengesWhere(opts.viewerId),
      opts.category ? { category: { slug: opts.category } } : {},
      opts.q ? { OR: [{ title: { contains: opts.q, mode: "insensitive" } }, { description: { contains: opts.q, mode: "insensitive" } }] } : {},
      opts.onlyWithMarkets || opts.sort === "markets" || opts.sort === "volume" || opts.sort === "liquidity" ? { market: { status: { in: ["OPEN", "CLOSED", "RESOLVED"] } } } : {},
      opts.sort === "ending" ? { status: { in: ["ACTIVE", "UPCOMING"] }, endDate: { gt: new Date() } } : {},
    ],
  };
  const orderBy: Prisma.ChallengeOrderByWithRelationInput[] =
    opts.sort === "new" ? [{ createdAt: "desc" }]
    : opts.sort === "ending" ? [{ endDate: "asc" }]
    : opts.sort === "liquidity" ? [{ market: { liquidity: "desc" } }, { createdAt: "desc" }]
    : [{ participants: { _count: "desc" } }, { createdAt: "desc" }]; // trending & participants
  const take = opts.take ?? 24;
  // Volume is an aggregate over confirmed trades, so rank a wider candidate set in memory.
  const rows = await prisma.challenge.findMany({ where, orderBy, take: opts.sort === "volume" ? 500 : take, include: challengeCardInclude });
  const vol = await volumes(rows.flatMap((r) => (r.market ? [r.market.id] : [])));
  const out = rows.map((r) => ({ ...r, volumeMicro: r.market ? vol.get(r.market.id) ?? 0n : 0n }));
  if (opts.sort === "volume") out.sort((a, b) => (b.volumeMicro > a.volumeMicro ? 1 : b.volumeMicro < a.volumeMicro ? -1 : 0));
  return out.slice(0, take);
}

export async function platformStats() {
  const [users, challenges, activeMarkets, participants, approvedEvidence, communities] = await Promise.all([
    prisma.user.count(),
    prisma.challenge.count({ where: { status: { notIn: ["DRAFT", "PENDING_MARKET", "CANCELLED"] } } }),
    prisma.market.count({ where: { status: "OPEN" } }),
    prisma.participant.count(),
    prisma.evidence.count({ where: { status: "APPROVED" } }),
    prisma.community.count({ where: { visibility: "PUBLIC" } }),
  ]);
  return { users, challenges, activeMarkets, participants, approvedEvidence, communities };
}

export async function listCategories() {
  return prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, name: true, description: true, icon: true, _count: { select: { challenges: { where: { visibility: "PUBLIC", status: { notIn: ["DRAFT", "PENDING_MARKET"] } } } } } },
  });
}
