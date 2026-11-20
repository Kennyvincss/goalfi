import Link from "next/link";
import { prisma } from "@goalfi/db";
import { formatUsd } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { CollateralBalance } from "@/components/wallet/balance";
import { getCurrentUser } from "@/lib/server/auth";
import { PUBLIC_DEPLOYMENT } from "@/lib/public-chain";

export const metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

export default async function Portfolio() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Sign in to see your portfolio" action={<Button asChild><Link href="/login?next=/portfolio">Sign in</Link></Button>} />
      </div>
    );
  }
  if (!user.walletAddress) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Link a Solana wallet to trade" action={<Button asChild><Link href="/settings#wallet">Link wallet</Link></Button>}>
          Your positions are read directly from your wallet’s on-chain token balances.
        </EmptyState>
      </div>
    );
  }
  const txs = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { market: { select: { challenge: { select: { title: true, slug: true } } } } },
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Wallet</CardTitle></CardHeader>
          <CardContent className="font-mono text-xs break-all">{user.walletAddress}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{PUBLIC_DEPLOYMENT.collateralSymbol} balance (on-chain)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            <CollateralBalance owner={user.walletAddress} mint={PUBLIC_DEPLOYMENT.collateralMint} symbol={PUBLIC_DEPLOYMENT.collateralSymbol} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Transaction history</CardTitle></CardHeader>
        <CardContent>
          {txs.length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Market</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody className="divide-y">
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2">{t.market?.challenge.title ?? "—"}</td>
                    <td>{t.kind.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="tabular">{formatUsd(t.amount)}</td>
                    <td>{t.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
