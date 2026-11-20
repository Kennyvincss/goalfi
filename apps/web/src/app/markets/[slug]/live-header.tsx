"use client";

import { formatProbability } from "@goalfi/core";
import { useLiveMarket } from "./live-market";

const usd = (micro: number) => (micro / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Live YES/NO probabilities and pool depth read straight from the on-chain market. */
export function LiveHeader({ fallbackYes }: { fallbackYes: number | null }) {
  const { view, cfg, loaded, rpcError } = useLiveMarket();
  const winner = cfg.winningOutcome ?? (view?.resolved && (view.winningSide === "YES" || view.winningSide === "NO") ? view.winningSide : null);
  if (view?.resolved || cfg.winningOutcome) {
    return (
      <div className={`rounded-lg p-5 ${winner === "YES" ? "bg-yes-soft" : winner === "NO" ? "bg-no-soft" : "bg-muted"}`}>
        <div className="text-xs font-medium text-muted-foreground">Resolved on-chain</div>
        <div className={`text-3xl font-bold ${winner === "YES" ? "text-yes" : winner === "NO" ? "text-no" : ""}`}>{winner ? `${winner} won` : "Resolved"}</div>
        <p className="mt-1 text-sm text-muted-foreground">{winner ? `Each ${winner} share redeems for 1 ${cfg.symbol}. ${winner === "YES" ? "NO" : "YES"} shares are worth nothing.` : "Winning shares redeem for 1 each."}</p>
      </div>
    );
  }
  const live = view && Number.isFinite(view.pool.yesPrice);
  const yes = live ? view.pool.yesPrice : fallbackYes;
  return (
    <div className="space-y-3">
      {yes !== null && Number.isFinite(yes) ? (
        <>
          <div className="flex items-end justify-between">
            <div><div className="text-xs font-medium text-yes">YES</div><div className="text-4xl font-bold text-yes tabular">{formatProbability(yes)}</div></div>
            <div className="text-right"><div className="text-xs font-medium text-no">NO</div><div className="text-4xl font-bold text-no tabular">{formatProbability(1 - yes)}</div></div>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-no-soft"><div className="bg-yes transition-all" style={{ width: `${yes * 100}%` }} /></div>
        </>
      ) : <p className="text-sm text-muted-foreground">{loaded ? "No price yet (market awaiting liquidity)." : "Loading price…"}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
        {live ? <span className="text-yes">● Live from Solana</span> : rpcError ? <span>Showing last indexed price</span> : null}
        {view && view.pool.poolValue > 0 && <span>Pool value {usd(view.pool.poolValue)} {cfg.symbol}</span>}
        {view && view.pool.lEff > 0 && <span>Effective liquidity L {usd(view.pool.lEff)}</span>}
      </div>
    </div>
  );
}
