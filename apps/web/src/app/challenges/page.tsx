import Link from "next/link";
import { prisma } from "@goalfi/db";
import { Button } from "@/components/ui/button";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { ChallengeBrowser, type BrowserParams } from "@/components/listing/challenge-browser";
import { getCurrentUser } from "@/lib/server/auth";
import { challengeCardInclude } from "@/lib/server/queries";

export const metadata = { title: "Challenges" };
export const dynamic = "force-dynamic";

export default async function Challenges({ searchParams }: { searchParams: Promise<BrowserParams> }) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const mine = user
    ? await prisma.challenge.findMany({
        where: { OR: [{ creatorId: user.id }, { participants: { some: { userId: user.id } } }], status: { not: "CANCELLED" } },
        orderBy: { endDate: "asc" },
        take: 12,
        include: challengeCardInclude,
      })
    : [];
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Challenges</h1>
          <p className="mt-1 text-muted-foreground">Commit, compete and prove it.</p>
        </div>
        <Button asChild><Link href="/challenges/new">Create a challenge</Link></Button>
      </div>
      {user && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your challenges</h2>
          <div className="mt-4">
            {mine.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{mine.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
            ) : (
              <EmptyState title="You haven’t joined or created any challenges yet" />
            )}
          </div>
        </section>
      )}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">All challenges</h2>
        <ChallengeBrowser basePath="/challenges" params={params} viewerId={user?.id ?? null} />
      </section>
    </div>
  );
}
