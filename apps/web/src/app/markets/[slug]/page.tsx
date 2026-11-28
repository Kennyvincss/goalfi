import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { prisma } from "@goalfi/db";
import { PM_AMM_DEPLOYMENTS } from "@goalfi/chain";
import { formatUsd } from "@goalfi/core";
import { challengeAccess, challengeMarketLimits, tradeRestrictions } from "@goalfi/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryIcon } from "@/components/category-icon";
import { getCurrentUser } from "@/lib/server/auth";
import { actorOf, services } from "@/lib/server/services";
import { volumes } from "@/lib/server/queries";
import { timeRemaining } from "@/lib/utils";
import { LiveMarketProvider, type MarketCfg } from "./live-market";
import { LiveHeader } from "./live-header";
import { TradePanel } from "./trade-panel";
import { PositionPanel } from "./position-panel";
import { PriceChart } from "./price-chart";
import { CreatorRecord } from "@/components/profile/creator-record";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  BUY_YES: "Bought YES", BUY_NO: "Bought NO", SELL_YES: "Sold YES", SELL_NO: "Sold NO",
  CLAIM_WINNINGS: "Claimed", REDEEM_PAIR: "Redeemed pairs", DEPOSIT_LIQUIDITY: "Added liquidity",
};
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");
const fmtDate = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await prisma.challenge.findUnique({ where: { slug: (await params).slug }, select: { title: true, visibility: true } });
  return { title: c?.visibility === "PUBLIC" ? `Market: ${c.title}` : "Market" };
}

export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const row = await prisma.challenge.findUnique({ where: { slug }, select: { id: true } });
  if (!row) notFound();
  const access = await challengeAccess(services().db, row.id, user ? actorOf(user) : null);
  if (!access.canView) notFound();
  const c = await prisma.challenge.findUniqueOrThrow({
    where: { id: row.id },
    include: {
      category: true, community: { select: { slug: true, name: true } }, _count: { select: { participants: true } }, creator: { select: { username: true } },
      market: { include: { snapshots: { orderBy: { takenAt: "asc" }, take: 500, select: { takenAt: true, yesPrice: true } } } },
    },
  });
  const m = c.market;
  if (!m?.marketAddress || m.status === "CREATING" || m.status === "FAILED") notFound();

  const [vol, activity, myPositions] = await Promise.all([
    volumes([m.id]),
    prisma.transaction.findMany({
      where: { marketId: m.id, status: "CONFIRMED", kind: { in: ["BUY_YES", "BUY_NO", "SELL_YES", "SELL_NO", "CLAIM_WINNINGS", "REDEEM_PAIR", "DEPOSIT_LIQUIDITY"] } },
      orderBy: { confirmedAt: "desc" }, take: 20,
      select: { kind: true, amount: true, outputAmount: true, confirmedAt: true, signature: true, user: { select: { walletAddress: true } } },
    }),
    user ? prisma.position.findMany({ where: { userId: user.id, marketId: m.id } }) : Promise.resolve([]),
  ]);
  const deployment = Object.values(PM_AMM_DEPLOYMENTS).find((d) => d.collateralMint === m.collateralMint);
  const symbol = deployment?.collateralSymbol ?? "USDC";
  const explorer = (path: string) => `https://solscan.io/${path}${m.cluster === "DEVNET" ? "?cluster=devnet" : ""}`;
  const points = m.snapshots.filter((s) => Number.isFinite(s.yesPrice)).map((s) => ({ t: s.takenAt.getTime(), yes: s.yesPrice }));
  const lastYes = points.at(-1)?.yes ?? null;
  const limits = await challengeMarketLimits(services(), c.id);
  const restrict = user ? await tradeRestrictions(services(), user.id, c.id) : { buy: null, no: null };
  const cfg: MarketCfg = {
    buyBlockedReason: restrict.buy,
    noBlockedReason: restrict.no,
    maxTradeMicro: (BigInt(limits.maxTradeUsdc) * 1_000_000n).toString(),
    easyToGame: limits.easyToGame,
    marketId: m.id, marketAddress: m.marketAddress, authority: m.authority, programId: m.programId, collateralMint: m.collateralMint,
    symbol, cluster: m.cluster, linkedWallet: user?.walletAddress ?? null, signedIn: !!user,
    winningOutcome: m.status === "RESOLVED" && m.winningOutcome ? (m.winningOutcome === 1 ? "YES" : "NO") : null,
  };
  const invested = {
    yes: (myPositions.find((p) => p.outcome === 1)?.amount ?? 0n).toString(),
    no: (myPositions.find((p) => p.outcome === 2)?.amount ?? 0n).toString(),
  };

  return (
    <LiveMarketProvider cfg={cfg}>
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <CategoryIcon icon={c.category.icon} className="size-4" />{c.category.name}
              {c.community && <>· <Link className="hover:text-foreground" href={`/communities/${c.community.slug}`}>{c.community.name}</Link></>}
              <Badge variant={m.status === "OPEN" ? "yes" : "outline"}>{m.status.replaceAll("_", " ").toLowerCase()}</Badge>
              {m.cluster === "DEVNET" && <Badge variant="warning">devnet · test tokens</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{c.marketQuestion ?? c.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Challenge: <Link className="text-primary" href={`/challenges/${c.slug}`}>{c.title}</Link> · {c._count.participants} participants · {m.status === "RESOLVED" ? "resolved" : m.status === "OPEN" || m.status === "AWAITING_LIQUIDITY" ? timeRemaining(m.endTs) : "trading closed"}
            </p>
            <div className="mt-1"><CreatorRecord userId={c.creatorId} username={c.creator.username} /></div>
            {m.hostTradedAt && <p className="mt-3 rounded-md bg-no-soft px-3 py-2 text-sm text-no" role="alert"><b>⚠ An organiser traded on this market.</b> The creator, a co-admin or a verifier of this challenge bought shares here, which they aren’t allowed to do. They lost 50 reputation. Keep it in mind before you trade.</p>}
          </div>

          <Card>
            <CardContent className="space-y-5 pt-5">
              <LiveHeader fallbackYes={lastYes} />
              <PriceChart points={points} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Volume (via GoalFi)", `${formatUsd(vol.get(m.id) ?? 0n)} ${symbol}`],
              ["Pool value (indexed)", m.liquidity > 0n ? `${formatUsd(m.liquidity)} ${symbol}` : "—"],
              ["Initial liquidity", `${formatUsd(m.fundedAmount)} ${symbol}`],
              ["Trading closes", fmtDate(m.endTs)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-0.5 font-semibold tabular">{v}</div></div>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Resolution rules</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><b>YES</b> if: {c.successCriteria}</p>
              <p className="text-muted-foreground">
                Evidence is reviewed by {c.requiredApprovals}+ appointed verifiers, with a {c.disputeWindowHours}h dispute window. After the end date, once every submission is
                reviewed and every dispute settled, a challenge administrator confirms the outcome computed from approved evidence, and GoalFi resolves the market on-chain.
                Each winning share then redeems for 1 {symbol}.
              </p>
              {c.reviewDeadlineHours && <p className="text-muted-foreground">Verifiers have {c.reviewDeadlineHours}h after the end to decide. Evidence not approved by then counts as rejected.</p>}
              <p className="text-muted-foreground">{c.autoSettle ? "This market settles automatically with the computed outcome once review and disputes are finished." : "A challenge administrator confirms the outcome after review."}</p>
              <p className="text-muted-foreground">If the challenge is suspended, a YES/NO market can’t be cancelled on-chain; it resolves per these rules. YES+NO pairs can always be redeemed 1:1.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
            <CardContent>
              {activity.length === 0 ? <p className="text-sm text-muted-foreground">No trades yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Activity</th><th className="pr-3">Amount</th><th className="pr-3">Wallet</th><th>When</th></tr></thead>
                    <tbody className="divide-y">
                      {activity.map((t) => {
                        const buy = t.kind.startsWith("BUY"), sell = t.kind.startsWith("SELL");
                        const amt = buy ? `${formatUsd(t.amount)} ${symbol} → ${formatUsd(t.outputAmount ?? 0n)} sh` : sell ? `${formatUsd(t.amount)} sh → ${formatUsd(t.outputAmount ?? 0n)} ${symbol}` : `${formatUsd(t.amount)} ${symbol}`;
                        return (
                          <tr key={t.signature}>
                            <td className={`py-2 pr-3 ${t.kind.endsWith("YES") ? "text-yes" : t.kind.endsWith("NO") ? "text-no" : ""}`}>{KIND_LABEL[t.kind] ?? t.kind}</td>
                            <td className="pr-3 whitespace-nowrap">{amt}</td>
                            <td className="pr-3 font-mono text-xs">{short(t.user?.walletAddress)}</td>
                            <td className="whitespace-nowrap"><a className="hover:text-primary" href={explorer(`tx/${t.signature}`)} target="_blank" rel="noreferrer">{t.confirmedAt ? fmtDate(t.confirmedAt) : "—"}</a></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Market information</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
              <span className="text-muted-foreground">Engine</span><span>Predict pm-AMM (Paradigm uniform AMM), 2% swap fee</span>
              <span className="text-muted-foreground">Market account</span><a className="flex items-center gap-1 break-all font-mono text-xs text-primary" href={explorer(`account/${m.marketAddress}`)} target="_blank" rel="noreferrer">{m.marketAddress}<ExternalLink className="size-3 shrink-0" /></a>
              <span className="text-muted-foreground">Resolution authority</span><span className="break-all font-mono text-xs">{m.authority}</span>
              <span className="text-muted-foreground">Collateral</span><span>{symbol} <span className="font-mono text-xs text-muted-foreground">{short(m.collateralMint)}</span></span>
              <span className="text-muted-foreground">Opening YES price</span><span>{m.initialPriceBps === 0 ? 50 : m.initialPriceBps / 100}%</span>
              {m.resolutionSignature && <><span className="text-muted-foreground">Resolution tx</span><a className="font-mono text-xs text-primary" href={explorer(`tx/${m.resolutionSignature}`)} target="_blank" rel="noreferrer">{short(m.resolutionSignature)}</a></>}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TradePanel />
          <PositionPanel investedMicro={invested} />
          <p className="px-1 text-xs text-muted-foreground">Prices are implied probabilities from the on-chain pool. Liquidity decays toward the end date by design, so large trades move the price more near the deadline.</p>
        </aside>
      </div>
    </LiveMarketProvider>
  );
}
