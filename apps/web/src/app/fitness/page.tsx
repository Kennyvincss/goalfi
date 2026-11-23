import Link from "next/link";
import { redirect } from "next/navigation";
import { suggestStepChallenges, type FitnessSuggestion } from "@goalfi/core";
import { prisma } from "@goalfi/db";
import { getFitnessConnection, recentDailySteps, syncUserSteps } from "@goalfi/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FitnessConnect } from "@/components/fitness/fitness-connect";
import { getCurrentUser } from "@/lib/server/auth";
import { fitnessConfig } from "@/lib/server/fitness";
import { services } from "@/lib/server/services";

export const metadata = { title: "Fitness" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function SuggestionCard({ s, communityId }: { s: FitnessSuggestion; communityId?: string }) {
  const q = new URLSearchParams({ suggest: s.id, ...(communityId ? { community: communityId } : {}) });
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="muted">{s.durationDays === 1 ? "Today" : `${s.durationDays} days`}</Badge>
          <Badge variant="muted">Verified by Google Health</Badge>
        </div>
        <CardTitle className="text-base">{s.title}</CardTitle>
        <CardDescription>{s.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3 text-sm">
        <p className="text-muted-foreground">Market: “{s.marketQuestion}” · suggested opening YES price {s.initialPriceBps / 100}%</p>
        <Button asChild size="sm"><Link href={`/challenges/new?${q}`}>Create this challenge</Link></Button>
      </CardContent>
    </Card>
  );
}

export default async function FitnessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/fitness");
  const ctx = services();
  const cfg = fitnessConfig();
  let conn = await getFitnessConnection(ctx, user.id);
  if (conn && cfg && conn.status === "ACTIVE") {
    // Respects the 10-minute minimum interval, so reloading doesn't hammer Google.
    await syncUserSteps(ctx, cfg, user.id, new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10), new Date(Date.now() + DAY).toISOString().slice(0, 10)).catch(() => 0);
    conn = await getFitnessConnection(ctx, user.id);
  }

  if (!conn) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Fitness</h1>
        <p className="text-muted-foreground">
          Connect your fitness account and GoalFi turns your real step counts into challenges and prediction markets that settle themselves: no screenshots, no verifiers.
        </p>
        <Card><CardContent className="pt-6"><FitnessConnect connected={false} available={!!cfg} next="/fitness" /></CardContent></Card>
      </div>
    );
  }

  const days = await recentDailySteps(ctx, user.id, 14);
  const byDate = new Map(days.map((d) => [d.date, d.value]));
  const last7 = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * DAY).toISOString().slice(0, 10));
  const max = Math.max(10_000, ...last7.map((d) => byDate.get(d) ?? 0));
  // Today is still in progress, so suggestions use completed days only.
  const today = new Date().toISOString().slice(0, 10);
  const history = days.filter((d) => d.date !== today).map((d) => d.value);
  const personal = suggestStepChallenges(history).filter((s) => s.scope === "personal");
  const communities = await prisma.community.findMany({
    where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fitness</h1>
        <p className="mt-1 text-muted-foreground">Your synced steps, and challenges you can launch from them. Every one is verified automatically from Google Health.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 7 days</CardTitle>
          <CardDescription>Daily totals from Google Health. Watches upload in batches, so today can lag behind.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1.5">
            {last7.map((d) => {
              const v = byDate.get(d);
              return (
                <li key={d} className="grid grid-cols-[88px_1fr_80px] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                  <span className="h-2.5 rounded-full bg-muted">
                    {v !== undefined && <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />}
                  </span>
                  <span className="tabular text-right">{v !== undefined ? fmt(v) : <span className="text-muted-foreground">no data</span>}</span>
                </li>
              );
            })}
          </ul>
          <FitnessConnect connected status={conn.status} lastSyncAt={conn.lastSyncAt?.toISOString() ?? null} lastError={conn.lastError} available={!!cfg} next="/fitness" />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Suggested for you</h2>
        <p className="text-sm text-muted-foreground">
          {history.length > 0
            ? `Targets are based on your last ${history.length} complete day${history.length === 1 ? "" : "s"} (average ${fmt(history.reduce((a, b) => a + b, 0) / history.length)} steps). The opening price reflects how often you’ve hit each target.`
            : "No complete days synced yet, so these targets start from 6,000 steps a day. They adjust once your steps sync."}
        </p>
        <div className="grid gap-4 md:grid-cols-3">{personal.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
      </section>

      {communities.map((c) => {
        const group = suggestStepChallenges(history, { name: c.name, memberCount: c._count.members }).filter((s) => s.scope === "group");
        if (group.length === 0) return null;
        return (
          <section key={c.id} className="space-y-3">
            <h2 className="text-xl font-semibold">For {c.name}</h2>
            <p className="text-sm text-muted-foreground">{c._count.members} members. Everyone who joins needs to connect their own fitness account.</p>
            <div className="grid gap-4 md:grid-cols-2">{group.map((s) => <SuggestionCard key={s.id} s={s} communityId={c.id} />)}</div>
          </section>
        );
      })}
    </div>
  );
}
