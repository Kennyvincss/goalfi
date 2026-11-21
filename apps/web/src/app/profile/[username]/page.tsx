import { notFound } from "next/navigation";
import { prisma } from "@goalfi/db";
import { Badge } from "@/components/ui/badge";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";
import { challengeCardInclude, visibleChallengesWhere } from "@/lib/server/queries";
import { userStats } from "@/lib/server/user-stats";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  return { title: `@${(await params).username}` };
}

export default async function Profile({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const viewer = await getCurrentUser();
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, username: true, displayName: true, bio: true, createdAt: true, walletAddress: true, telegramUsername: true, suspendedAt: true },
  });
  if (!user || user.suspendedAt) notFound();
  const [stats, challenges] = await Promise.all([
    userStats(user.id),
    prisma.challenge.findMany({
      where: { AND: [visibleChallengesWhere(viewer?.id ?? null), { OR: [{ creatorId: user.id }, { participants: { some: { userId: user.id } } }] }] },
      orderBy: { createdAt: "desc" }, take: 12, include: challengeCardInclude,
    }),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div className="flex items-center gap-4">
        <span className="grid size-16 place-items-center rounded-full bg-accent text-2xl font-semibold text-accent-foreground">
          {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1 className="text-2xl font-bold">{user.displayName ?? user.username}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            @{user.username} · joined {user.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            {user.walletAddress && <Badge variant="outline">Wallet linked</Badge>}
            {user.telegramUsername && <Badge variant="outline">Telegram</Badge>}
          </div>
        </div>
      </div>
      {user.bio && <p className="text-muted-foreground">{user.bio}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Reputation" value={stats.reputation} />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Joined" value={stats.joined} />
        <Stat label="Approved submissions" value={stats.approved} />
        <Stat label="Longest streak" value={stats.longestStreak} />
      </div>
      <section>
        <h2 className="text-lg font-semibold">Challenges</h2>
        <div className="mt-4">
          {challenges.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">{challenges.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
          ) : <EmptyState title="No visible challenges yet" />}
        </div>
      </section>
    </div>
  );
}
