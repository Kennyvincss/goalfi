import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Compass, Plus, Send, Wallet } from "lucide-react";
import { prisma } from "@goalfi/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";
import { challengeCardInclude, listChallenges } from "@/lib/server/queries";
import { userStats } from "@/lib/server/user-stats";
import { timeRemaining } from "@/lib/utils";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const [stats, active, trendingMarkets, positions, claimable, activity] = await Promise.all([
    userStats(user.id),
    prisma.challenge.findMany({
      where: { participants: { some: { userId: user.id } }, status: { in: ["ACTIVE", "UPCOMING", "IN_REVIEW"] } },
      orderBy: { endDate: "asc" }, take: 6, include: challengeCardInclude,
    }),
    listChallenges({ viewerId: user.id, sort: "markets", take: 3, onlyWithMarkets: true }),
    prisma.position.count({ where: { userId: user.id, market: { status: { in: ["OPEN", "CLOSED"] } } } }),
    prisma.position.count({ where: { userId: user.id, market: { status: "RESOLVED" } } }),
    prisma.challenge.findMany({
      where: { community: { members: { some: { userId: user.id } } }, status: { notIn: ["DRAFT", "PENDING_MARKET"] } },
      orderBy: { createdAt: "desc" }, take: 5, select: { slug: true, title: true, createdAt: true, community: { select: { name: true } } },
    }),
  ]);
  const deadlines = active.filter((c) => c.endDate > new Date()).slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user.displayName ?? user.username}</h1>
          <p className="mt-1 text-muted-foreground">Here’s where your commitments stand.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/challenges/new"><Plus />Create challenge</Link></Button>
          <Button asChild variant="outline"><Link href="/discover"><Compass />Explore</Link></Button>
          <Button asChild variant="outline"><Link href="/markets"><BarChart3 />Markets</Link></Button>
          {!user.telegramId && <Button asChild variant="outline"><Link href="/settings#telegram"><Send />Connect Telegram</Link></Button>}
          <Button asChild variant="outline"><Link href="/portfolio"><Wallet />Portfolio</Link></Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Joined" value={stats.joined} />
        <Stat label="Created" value={stats.created} />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Active" value={stats.active} />
        <Stat label="Approved submissions" value={stats.approved} />
        <Stat label="Current streak" value={stats.currentStreak} hint={`Best ${stats.longestStreak}`} />
        <Stat label="Reputation" value={stats.reputation} />
        <Stat label="Open positions" value={user.walletAddress ? positions : "—"} hint={user.walletAddress ? (claimable ? `${claimable} resolved` : undefined) : "No wallet linked"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="text-lg font-semibold">Active challenges</h2>
          <div className="mt-4">
            {active.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">{active.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
            ) : (
              <EmptyState title="No active challenges" action={<Button asChild variant="outline"><Link href="/discover">Find one to join</Link></Button>} />
            )}
          </div>
        </section>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Upcoming deadlines</CardTitle></CardHeader>
            <CardContent>
              {deadlines.length > 0 ? (
                <ul className="space-y-3 text-sm">
                  {deadlines.map((c) => (
                    <li key={c.id} className="flex justify-between gap-3">
                      <Link href={`/challenges/${c.slug}`} className="line-clamp-1 hover:text-primary">{c.title}</Link>
                      <span className="shrink-0 text-muted-foreground tabular">{timeRemaining(c.endDate)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Nothing due.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Community activity</CardTitle></CardHeader>
            <CardContent>
              {activity.length > 0 ? (
                <ul className="space-y-3 text-sm">
                  {activity.map((a) => (
                    <li key={a.slug}>
                      <Link href={`/challenges/${a.slug}`} className="hover:text-primary">{a.title}</Link>
                      <div className="text-xs text-muted-foreground">New in {a.community?.name}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Join a community to see its activity.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold">Trending markets</h2>
        <div className="mt-4">
          {trendingMarkets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-3">{trendingMarkets.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
          ) : <EmptyState title="No live markets yet" />}
        </div>
      </section>
    </div>
  );
}
