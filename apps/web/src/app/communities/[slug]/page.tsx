import { notFound } from "next/navigation";
import { prisma } from "@goalfi/db";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";
import { challengeCardInclude, visibleChallengesWhere } from "@/lib/server/queries";
import { JoinCommunity } from "./join-community";

export const dynamic = "force-dynamic";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getCurrentUser();
  const c = await prisma.community.findUnique({
    where: { slug },
    include: { creator: { select: { username: true } }, _count: { select: { members: true } } },
  });
  if (!c) notFound();
  const isMember = viewer ? !!(await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: c.id, userId: viewer.id } } })) : false;
  if (c.visibility === "PRIVATE" && !isMember) notFound();
  const challenges = await prisma.challenge.findMany({
    where: { AND: [{ communityId: c.id }, visibleChallengesWhere(viewer?.id ?? null)] },
    orderBy: { endDate: "desc" }, take: 24, include: challengeCardInclude,
  });
  const leaders = await prisma.communityMember.findMany({
    where: { communityId: c.id, user: { reputationScore: { gt: 0 } } },
    orderBy: { user: { reputationScore: "desc" } }, take: 10,
    select: { user: { select: { username: true, reputationScore: true } } },
  });
  const active = challenges.filter((x) => ["ACTIVE", "UPCOMING"].includes(x.status));
  const done = challenges.filter((x) => x.status === "RESOLVED");
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
        {c.description && <p className="mt-2 max-w-2xl text-muted-foreground">{c.description}</p>}
        <p className="mt-1 text-sm text-muted-foreground">Admin @{c.creator.username}</p>
        {viewer && !isMember && c.visibility === "PUBLIC" && <div className="mt-4"><JoinCommunity communityId={c.id} /></div>}
      </div>
      {c.announcement && <div className="rounded-lg border bg-accent px-4 py-3 text-sm text-accent-foreground">{c.announcement}</div>}
      <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
        <Stat label="Members" value={c._count.members} />
        <Stat label="Active" value={active.length} />
        <Stat label="Completed" value={done.length} />
      </div>
      <section>
        <h2 className="text-lg font-semibold">Active challenges</h2>
        <div className="mt-4">{active.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map((x) => <ChallengeCard key={x.id} c={x} />)}</div> : <EmptyState title="No active challenges" />}</div>
      </section>
      {leaders.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Community leaderboard</h2>
          <ol className="mt-4 max-w-md space-y-2 text-sm">
            {leaders.map((l, i) => (
              <li key={l.user.username} className="flex gap-3"><span className="w-5 text-right text-muted-foreground">{i + 1}</span><span className="flex-1">@{l.user.username}</span><span className="tabular">{l.user.reputationScore} pts</span></li>
            ))}
          </ol>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Completed</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{done.map((x) => <ChallengeCard key={x.id} c={x} />)}</div>
        </section>
      )}
    </div>
  );
}
