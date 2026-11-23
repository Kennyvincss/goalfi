import Link from "next/link";
import { prisma } from "@goalfi/db";
import { PM_AMM_DEPLOYMENTS } from "@goalfi/chain";
import { formatUsd } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { CollateralBalance } from "@/components/wallet/balance";
import { getCurrentUser } from "@/lib/server/auth";
import { PUBLIC_CLUSTER } from "@/lib/public-chain";
import { Positions, type PortfolioMarket } from "./positions";

export const metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

const KIND = (k: string) => k.replaceAll("_", " ").toLowerCase();

export default async function Portfolio() {
  const user = await getCurrentUser();
  if (!user) {
    return <div className="mx-auto max-w-3xl px-4 py-16"><EmptyState title="Sign in to see your portfolio" action={<Button asChild><Link href="/login?next=/portfolio">Sign in</Link></Button>} /></div>;
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
  const dep = PM_AMM_DEPLOYMENTS[PUBLIC_CLUSTER];
  const cluster = dep.dbCluster;
  const [markets, positions, txs, realized] = await Promise.all([
    // Every GoalFi market on this cluster; the client derives YES/NO mints and matches them to wallet balances.
    prisma.market.findMany({
      where: { cluster, marketAddress: { not: null }, status: { in: ["AWAITING_LIQUIDITY", "OPEN", "CLOSED", "RESOLVING", "RESOLVED"] } },
      orderBy: { createdAt: "desc" }, take: 1000,
      select: {
        id: true, marketAddress: true, status: true, authority: true, winningOutcome: true,
        challenge: { select: { slug: true, title: true, marketQuestion: true } },
        snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { yesPrice: true } },
      },
    }),
    prisma.position.findMany({ where: { userId: user.id }, select: { marketId: true, outcome: true, amount: true } }),
    prisma.transaction.findMany({
      where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50,
      include: { market: { select: { cluster: true, challenge: { select: { title: true, slug: true } } } } },
    }),
    prisma.$queryRaw<{ received: bigint | null }[]>`
      -- Sells store collateral received in outputAmount; claims and pair redemptions store it in amount.
      SELECT SUM(CASE WHEN "transaction_type" IN ('CLAIM_WINNINGS','REDEEM_PAIR') THEN "amount" ELSE COALESCE("outputAmount", 0) END)::bigint AS received
      FROM "transactions" WHERE "user_id" = ${user.id} AND "status" = 'CONFIRMED' AND "transaction_type" IN ('SELL_YES','SELL_NO','CLAIM_WINNINGS','REDEEM_PAIR')`,
  ]);
  const inv = (marketId: string, outcome: number) => positions.find((p) => p.marketId === marketId && p.outcome === outcome)?.amount ?? 0n;
  const pm: PortfolioMarket[] = markets.map((m) => ({
    id: m.id, address: m.marketAddress!, slug: m.challenge.slug, title: m.challenge.marketQuestion ?? m.challenge.title, status: m.status, authority: m.authority,
    winningOutcome: m.status === "RESOLVED" && m.winningOutcome ? (m.winningOutcome === 1 ? "YES" : "NO") : null,
    lastYes: m.snapshots[0] && Number.isFinite(m.snapshots[0].yesPrice) ? m.snapshots[0].yesPrice : null,
    investedYes: inv(m.id, 1).toString(), investedNo: inv(m.id, 2).toString(),
  }));
  const totalInvested = positions.reduce((s, p) => s + p.amount, 0n);
  const received = BigInt(realized[0]?.received ?? 0n);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Wallet</CardTitle></CardHeader>
          <CardContent className="font-mono text-xs break-all">{user.walletAddress}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{dep.collateralSymbol} balance (on-chain)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold"><CollateralBalance owner={user.walletAddress} mint={dep.collateralMint} symbol={dep.collateralSymbol} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Via GoalFi (confirmed)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm tabular">
            <div className="flex justify-between"><span className="text-muted-foreground">Spent on buys</span><span>{formatUsd(totalInvested)} {dep.collateralSymbol}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Received (sells, redeems, claims)</span><span>{formatUsd(received)} {dep.collateralSymbol}</span></div>
          </CardContent>
        </Card>
      </div>

      <Positions wallet={user.walletAddress} markets={pm} programId={dep.programId} collateralMint={dep.collateralMint} symbol={dep.collateralSymbol} cluster={cluster} />

      <Card>
        <CardHeader><CardTitle>Transaction history</CardTitle></CardHeader>
        <CardContent>
          {txs.length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Market</th><th className="pr-3">Type</th><th className="pr-3">In</th><th className="pr-3">Out</th><th>Status</th></tr></thead>
                <tbody className="divide-y">
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <a className="hover:text-primary" href={`https://solscan.io/tx/${t.signature}${t.market?.cluster === "DEVNET" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">
                          {t.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </a>
                      </td>
                      <td className="pr-3">{t.market ? <Link className="hover:text-primary" href={`/markets/${t.market.challenge.slug}`}>{t.market.challenge.title}</Link> : "—"}</td>
                      <td className="pr-3">{KIND(t.kind)}</td>
                      <td className="pr-3">{t.status === "CONFIRMED" ? formatUsd(t.amount) : "—"}</td>
                      <td className="pr-3">{t.outputAmount !== null ? formatUsd(t.outputAmount) : "—"}</td>
                      <td className={t.status === "FAILED" ? "text-no" : t.status === "PENDING" ? "text-warning" : ""} title={t.error ?? undefined}>{t.status.toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
