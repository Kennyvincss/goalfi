import { notFound } from "next/navigation";
import { prisma } from "@goalfi/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function Admin() {
  const user = await getCurrentUser();
  if (user?.role !== "PLATFORM_ADMIN") notFound(); // don't reveal the route exists
  const [users, communities, challenges, markets, pendingTx, openReports, logs] = await Promise.all([
    prisma.user.count(), prisma.community.count(), prisma.challenge.count(), prisma.market.count(),
    prisma.transaction.count({ where: { status: "PENDING" } }), prisma.report.count({ where: { status: "OPEN" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { username: true } } } }),
  ]);
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Platform admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="Users" value={users} /><Stat label="Communities" value={communities} /><Stat label="Challenges" value={challenges} />
        <Stat label="Markets" value={markets} /><Stat label="Pending txs" value={pendingTx} /><Stat label="Open reports" value={openReports} />
      </div>
      <Card>
        <CardHeader><CardTitle>Audit log</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id}><td className="py-2 tabular">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{l.actor?.username ?? "system"}</td><td className="font-mono text-xs">{l.action}</td><td className="text-muted-foreground">{l.entityType}</td></tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
