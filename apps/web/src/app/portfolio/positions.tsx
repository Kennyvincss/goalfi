"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/wallet-button";
import { buildClaimWinningsTx, PmAmmClient, preflightTransaction, scanOwnerHoldings, type MarketHolding } from "@goalfi/chain/browser";
import { formatProbability, valuePosition } from "@goalfi/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/app/markets/[slug]/live-market";

export interface PortfolioMarket {
  id: string;
  address: string;
  slug: string;
  title: string;
  status: string;
  authority: string;
  winningOutcome: "YES" | "NO" | null;
  lastYes: number | null;
  investedYes: string;
  investedNo: string;
}

const fmt = (micro: bigint) => (Number(micro) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Positions({ wallet, markets, programId, collateralMint, symbol, cluster }: {
  wallet: string;
  markets: PortfolioMarket[];
  programId: string;
  collateralMint: string;
  symbol: string;
  cluster: "DEVNET" | "MAINNET";
}) {
  const { connection } = useConnection();
  const w = useWallet();
  const router = useRouter();
  const [holdings, setHoldings] = useState<MarketHolding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const client = useMemo(() => PmAmmClient.readOnly(connection, new PublicKey(programId), new PublicKey(collateralMint)), [connection, programId, collateralMint]);
  const byAddr = useMemo(() => new Map(markets.map((m) => [m.address, m])), [markets]);

  const load = useCallback(async () => {
    try {
      setHoldings(await scanOwnerHoldings(connection, new PublicKey(programId), new PublicKey(wallet), markets.map((m) => m.address)));
      setError(null);
    } catch (e) {
      console.error("[portfolio] holdings scan failed", e);
      setError("Could not reach the Solana RPC to read your on-chain positions.");
    }
  }, [connection, programId, wallet, markets]);
  useEffect(() => { void load(); }, [load]);

  const rows = (holdings ?? []).flatMap((h) => {
    const m = byAddr.get(h.market);
    if (!m) return [];
    const resolved = m.status === "RESOLVED";
    const v = valuePosition({ yes: h.yes, no: h.no, yesPrice: m.lastYes, resolved, winner: m.winningOutcome });
    return [{ h, m, v, resolved }];
  });
  const open = rows.filter((r) => !r.resolved);
  const settled = rows.filter((r) => r.resolved);
  const openValue = open.reduce((s, r) => s + (r.v.kind === "mark" ? r.v.valueMicro : 0n), 0n);
  const claimable = settled.reduce((s, r) => s + (r.v.kind === "settled" ? r.v.claimableMicro : 0n), 0n);
  const walletOk = w.publicKey?.toBase58() === wallet;

  async function claim(m: PortfolioMarket) {
    if (!w.publicKey) return;
    setBusy(m.id);
    setMsg(null);
    try {
      const keys = { market: new PublicKey(m.address), authority: new PublicKey(m.authority), collateralMint: new PublicKey(collateralMint) };
      const tx = await buildClaimWinningsTx(client, { owner: w.publicKey, keys });
      const problem = await preflightTransaction(connection, w.publicKey, tx, { symbol });
      if (problem) {
        setMsg({ ok: false, text: problem });
        return;
      }
      const sig = await w.sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, "confirmed");
      const r = await fetch("/api/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: sig, marketId: m.id, kind: "CLAIM_WINNINGS" }) });
      setMsg(r.ok ? { ok: true, text: `Claimed from “${m.title}”.` } : { ok: false, text: "Claim confirmed on-chain, but GoalFi couldn’t record it yet." });
      await load();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  const renderRow = (r: (typeof rows)[number]) => {
    const { h, m, v } = r;
    return (
      <tr key={m.id} className="align-top">
        <td className="py-3 pr-3"><Link className="font-medium hover:text-primary" href={`/markets/${m.slug}`}>{m.title}</Link><div className="text-xs text-muted-foreground">{m.status.replaceAll("_", " ").toLowerCase()}</div></td>
        <td className="pr-3">
          {h.yes > 0n && <div><Badge variant="yes">YES</Badge> {fmt(h.yes)}</div>}
          {h.no > 0n && <div className="mt-1"><Badge variant="no">NO</Badge> {fmt(h.no)}</div>}
        </td>
        <td className="pr-3 text-muted-foreground">{BigInt(m.investedYes) + BigInt(m.investedNo) > 0n ? `${fmt(BigInt(m.investedYes) + BigInt(m.investedNo))} ${symbol}` : "—"}</td>
        <td className="pr-3">
          {v.kind === "mark" && <>{fmt(v.valueMicro)} {symbol}<div className="text-xs text-muted-foreground">at YES {m.lastYes !== null ? formatProbability(m.lastYes) : "—"} (estimate)</div></>}
          {v.kind === "settled" && <span className={v.claimableMicro > 0n ? "font-medium text-yes" : "text-muted-foreground"}>{fmt(v.claimableMicro)} {symbol}<div className="text-xs font-normal text-muted-foreground">{m.winningOutcome} won</div></span>}
          {v.kind === "unknown" && <span className="text-muted-foreground">—</span>}
        </td>
        <td className="text-right">
          {r.resolved && (walletOk ? (
            <Button size="sm" variant={v.kind === "settled" && v.claimableMicro > 0n ? "yes" : "outline"} disabled={busy === m.id} onClick={() => claim(m)}>
              {busy === m.id ? "Claiming…" : v.kind === "settled" && v.claimableMicro > 0n ? "Claim" : "Close"}
            </Button>
          ) : <span className="text-xs text-muted-foreground">Connect wallet</span>)}
        </td>
      </tr>
    );
  };

  const table = (list: typeof rows, empty: string) =>
    list.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Market</th><th className="pr-3">Shares</th><th className="pr-3">Invested via GoalFi</th><th className="pr-3">Value</th><th /></tr></thead>
          <tbody className="divide-y">{list.map(renderRow)}</tbody>
        </table>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Open positions" value={holdings ? open.length : "…"} />
        <Stat label="Open value (estimate)" value={holdings ? `${fmt(openValue)} ${symbol}` : "…"} hint="Shares × current price" />
        <Stat label="Claimable winnings" value={holdings ? `${fmt(claimable)} ${symbol}` : "…"} hint="Exact: 1 per winning share" />
      </div>
      {error && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{error}</p>}
      {!walletOk && settled.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <WalletButton style={{ height: 36, borderRadius: 8, fontSize: 13 }} />
          <span className="text-muted-foreground">Connect your linked wallet ({wallet.slice(0, 4)}…{wallet.slice(-4)}) to claim.</span>
        </div>
      )}
      {msg && <p className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-yes-soft text-yes" : "bg-no-soft text-no")} role="status">{msg.text}</p>}
      <Card>
        <CardHeader><CardTitle>Active positions</CardTitle></CardHeader>
        <CardContent>{holdings === null ? <p className="text-sm text-muted-foreground">{error ? "Unavailable until the RPC responds." : "Reading on-chain balances…"}</p> : table(open, "No open positions.")}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Resolved markets</CardTitle></CardHeader>
        <CardContent>{holdings === null ? <p className="text-sm text-muted-foreground">{error ? "Unavailable until the RPC responds." : "Reading on-chain balances…"}</p> : table(settled, "No unclaimed positions in resolved markets.")}</CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Balances are read directly from your wallet’s token accounts on Solana {cluster === "DEVNET" ? "devnet" : "mainnet"}. Open-position values are estimates at the current market price, not guaranteed sale proceeds.</p>
    </div>
  );
}
