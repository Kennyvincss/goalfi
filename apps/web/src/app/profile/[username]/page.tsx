import { notFound } from "next/navigation";
import { prisma } from "@goalfi/db";
import { Badge } from "@/components/ui/badge";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";
import { challengeCardInclude, visibleChallengesWhere } from "@/lib/server/queries";
import { earnedBadges, successRate } from "@goalfi/core";
import { activeStreaks, trackRecord } from "@goalfi/services";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BadgeList } from "@/components/profile/badges";
import { services } from "@/lib/server/services";

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
  const [record, streaks, challenges] = await Promise.all([
    trackRecord(services(), user.id),
    activeStreaks(services(), user.id),
    prisma.challenge.findMany({
      where: { AND: [visibleChallengesWhere(viewer?.id ?? null), { OR: [{ creatorId: user.id }, { participants: { some: { userId: user.id } } }] }] },
      orderBy: { createdAt: "desc" }, take: 12, include: challengeCardInclude,
    }),
  ]);
  const rate = successRate(record);
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
      <BadgeList badges={earnedBadges(record)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Reputation" value={record.reputation} />
        <Stat label="Success rate" value={rate === null ? "—" : `${Math.round(rate * 100)}%`} hint={`${record.completed} completed · ${record.failed} missed`} />
        <Stat label="Joined" value={record.joined} />
        <Stat label="Current streak" value={record.currentStreak} hint={`Best ${record.longestStreak}`} />
        <Stat label="Hosted" value={record.hosted} hint={`${record.hostedSettled} settled`} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">As a participant</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{record.completed} completed, {record.failed} missed{rate !== null ? ` (${Math.round(rate * 100)}% success)` : ""}.</p>
            <p className="text-muted-foreground">{record.appVerifiedCompleted} verified by a connected app.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">As a host</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{record.hosted} challenge{record.hosted === 1 ? "" : "s"} hosted, {record.marketsHosted} with a market.</p>
            {record.hostedSettled > 0 && <p className="text-muted-foreground">{record.hostedSettled} settled: {record.hostedYes} achieved, {record.hostedSettled - record.hostedYes} not.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Fair play</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{record.fairVerifications} verification decision{record.fairVerifications === 1 ? "" : "s"} upheld{record.overturned ? `, ${record.overturned} overturned on dispute` : ""}.</p>
            <p className={record.selfBetFlags ? "text-no" : "text-muted-foreground"}>
              {record.selfBetFlags ? `⚠ Bet against their own challenge ${record.selfBetFlags} time${record.selfBetFlags === 1 ? "" : "s"}.` : "Never flagged for betting against themselves."}
            </p>
          </CardContent>
        </Card>
      </div>
      {streaks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Live streaks</h2>
          <ul className="flex flex-wrap gap-2">
            {streaks.map((s) => (
              <li key={s.slug}><Link href={`/challenges/${s.slug}`} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:border-primary">🔥 {s.current} · {s.title}</Link></li>
            ))}
          </ul>
        </section>
      )}
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
