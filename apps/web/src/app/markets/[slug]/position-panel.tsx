"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { buildClaimWinningsTx, buildRedeemPairTx } from "@goalfi/chain/browser";
import { redeemablePairs, valuePosition } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { explorerTx, useLiveMarket, useSendTx } from "./live-market";

const fmt = (micro: bigint) => (Number(micro) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** The connected wallet's on-chain position, value, and claim/redeem actions. */
export function PositionPanel({ investedMicro }: { investedMicro: { yes: string; no: string } }) {
  const { cfg, client, keys, view, holdings, walletOk } = useLiveMarket();
  const wallet = useWallet();
  const { send, stage, result } = useSendTx();
  if (!wallet.publicKey || !holdings || !view) return null;
  const owner = wallet.publicKey;
  const winner = cfg.winningOutcome ?? (view.winningSide === "YES" || view.winningSide === "NO" ? view.winningSide : null);
  const val = valuePosition({ yes: holdings.yes, no: holdings.no, yesPrice: Number.isFinite(view.pool.yesPrice) ? view.pool.yesPrice : null, resolved: view.resolved, winner });
  const pairs = redeemablePairs(holdings.yes, holdings.no);
  const empty = holdings.yes === 0n && holdings.no === 0n;
  const invested = { yes: BigInt(investedMicro.yes), no: BigInt(investedMicro.no) };
  const hadPosition = invested.yes > 0n || invested.no > 0n;
  if (empty && !hadPosition) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Your position</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm tabular">
        <div className="grid grid-cols-2 gap-2">
          {(["YES", "NO"] as const).map((s) => (
            <div key={s} className={cn("rounded-md p-3", s === "YES" ? "bg-yes-soft" : "bg-no-soft")}>
              <div className={cn("text-xs font-semibold", s === "YES" ? "text-yes" : "text-no")}>{s} shares</div>
              <div className="text-lg font-semibold">{fmt(s === "YES" ? holdings.yes : holdings.no)}</div>
              {invested[s === "YES" ? "yes" : "no"] > 0n && <div className="text-xs text-muted-foreground">Bought via GoalFi for {fmt(invested[s === "YES" ? "yes" : "no"])} {cfg.symbol}</div>}
            </div>
          ))}
        </div>
        {val.kind === "mark" && !empty && (
          <div className="flex justify-between"><span className="text-muted-foreground">Value at current price (estimate)</span><span>{fmt(val.valueMicro)} {cfg.symbol}</span></div>
        )}
        {val.kind === "settled" && (
          <div className="flex justify-between font-medium"><span>Claimable ({winner} won)</span><span>{fmt(val.claimableMicro)} {cfg.symbol}</span></div>
        )}
        {view.resolved && empty && hadPosition && <p className="text-muted-foreground">Position settled. Nothing left to claim.</p>}
        {view.resolved && !empty && walletOk && (
          <Button className="w-full" variant="yes" disabled={!!stage}
            onClick={() => send(() => buildClaimWinningsTx(client, { owner, keys }), "CLAIM_WINNINGS", "Claim")}>
            {stage ?? (val.kind === "settled" && val.claimableMicro > 0n ? `Claim ${fmt(val.claimableMicro)} ${cfg.symbol}` : "Close position (burn losing shares)")}
          </Button>
        )}
        {!view.resolved && pairs > 0n && walletOk && (
          <div className="space-y-1">
            <Button className="w-full" variant="outline" disabled={!!stage}
              onClick={() => send(() => buildRedeemPairTx(client, { owner, keys, amount: pairs }), "REDEEM_PAIR", "Redeem")}>
              {stage ?? `Redeem ${fmt(pairs)} YES+NO pairs for ${fmt(pairs)} ${cfg.symbol}`}
            </Button>
            <p className="text-xs text-muted-foreground">Each YES+NO pair always redeems for exactly 1 {cfg.symbol}, fee-free.</p>
          </div>
        )}
        {result && (
          <div className={cn("rounded-md px-3 py-2", result.ok ? "bg-yes-soft text-yes" : "bg-no-soft text-no")} role="status">
            {result.text} {result.sig && <a className="underline" href={explorerTx(cfg.cluster, result.sig)} target="_blank" rel="noreferrer">View transaction</a>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
