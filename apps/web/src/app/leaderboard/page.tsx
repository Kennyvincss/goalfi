import Link from "next/link";
import { prisma } from "@goalfi/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

type Row = { username: string; displayName: string | null; value: number };

function Board({ title, desc, rows, unit }: { title: string; desc: string; rows: Row[]; unit: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{desc}</CardDescription></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No rankings yet.</p> : (
          <ol className="space-y-2.5">
            {rows.map((r, i) => (
              <li key={r.username} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-right text-muted-foreground tabular">{i + 1}</span>
                <Link href={`/profile/${r.username}`} className="flex-1 truncate hover:text-primary">{r.displayName ?? r.username}</Link>
                <span className="font-medium tabular">{r.value} <span className="text-xs text-muted-foreground">{unit}</span></span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

async function withUsers(rows: { userId: string; value: number }[]): Promise<Row[]> {
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, suspendedAt: null }, select: { id: true, username: true, displayName: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.flatMap((r) => { const u = byId.get(r.userId); return u ? [{ username: u.username, displayName: u.displayName, value: r.value }] : []; });
}

export default async function Leaderboard() {
  const [reputation, active, completed, streaks, verifiers] = await Promise.all([
    prisma.user.findMany({ where: { reputationScore: { gt: 0 }, suspendedAt: null }, orderBy: { reputationScore: "desc" }, take: 10, select: { username: true, displayName: true, reputationScore: true } }),
    prisma.evidence.groupBy({ by: ["userId"], where: { status: "APPROVED" }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
    prisma.participant.groupBy({ by: ["userId"], where: { status: "COMPLETED" }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
    prisma.streak.groupBy({ by: ["userId"], _max: { longest: true }, orderBy: { _max: { longest: "desc" } }, take: 10 }),
    prisma.reputationEvent.groupBy({ by: ["userId"], where: { activityType: "FAIR_VERIFICATION" }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
  ]);
  // Completion rate: completed / finished participations, minimum 3 finished.
  const rates = await prisma.$queryRaw<{ userId: string; value: number }[]>`
    SELECT "user_id" AS "userId", ROUND(100.0 * SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*))::int AS value
    FROM "participants" WHERE status IN ('COMPLETED', 'FAILED')
    GROUP BY "user_id" HAVING COUNT(*) >= 3 ORDER BY value DESC LIMIT 10`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mt-1 text-muted-foreground">Participation and trading are ranked separately. Reputation can’t be bought.</p>
      <h2 className="mt-10 text-lg font-semibold">Participation</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Board title="Reputation" desc="Overall standing" unit="pts" rows={reputation.map((u) => ({ username: u.username, displayName: u.displayName, value: u.reputationScore }))} />
        <Board title="Most active" desc="Approved submissions" unit="approved" rows={await withUsers(active.map((r) => ({ userId: r.userId, value: r._count._all })))} />
        <Board title="Most completed" desc="Challenges completed" unit="done" rows={await withUsers(completed.map((r) => ({ userId: r.userId, value: r._count._all })))} />
        <Board title="Highest completion rate" desc="Min. 3 finished challenges" unit="%" rows={await withUsers(rates)} />
        <Board title="Longest streaks" desc="Best streak ever" unit="days" rows={await withUsers(streaks.map((r) => ({ userId: r.userId, value: r._max.longest ?? 0 })))} />
        <Board title="Most reliable verifiers" desc="Reviews that matched the final decision" unit="reviews" rows={await withUsers(verifiers.map((r) => ({ userId: r.userId, value: r._count._all })))} />
      </div>
      <h2 className="mt-12 text-lg font-semibold">Trading</h2>
      <p className="mt-1 text-sm text-muted-foreground">Top traders and realized profits are computed from confirmed on-chain trades and claims on resolved markets.</p>
      <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Trading rankings appear once markets have resolved.</div>
    </div>
  );
}
