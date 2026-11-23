import { notFound } from "next/navigation";
import { prisma } from "@goalfi/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { getCurrentUser } from "@/lib/server/auth";
import { systemStatus, type CheckStatus } from "@/lib/server/system-status";

const ICON: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function Admin() {
  const user = await getCurrentUser();
  if (user?.role !== "PLATFORM_ADMIN") notFound(); // don't reveal the route exists
  const [checks, users, communities, challenges, markets, pendingTx, openReports, logs] = await Promise.all([
    systemStatus(),
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
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <p className="text-sm text-muted-foreground">
            {checks.some((c) => c.status === "error") ? "Some settings need fixing. Follow the steps under each ❌." : checks.some((c) => c.status === "warn") ? "Working, with warnings." : "Everything looks good."}
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {checks.map((c, i) => (
              <li key={i} className="flex gap-3 py-3 text-sm">
                <span aria-label={c.status}>{ICON[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{c.area}</div>
                  <div className="break-words text-muted-foreground">{c.detail}</div>
                  {c.fix && c.status !== "ok" && <div className="mt-1 break-words rounded-md bg-muted px-2 py-1">👉 {c.fix}</div>}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
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
