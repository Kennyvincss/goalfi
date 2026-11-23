"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/wallet-button";
import { buildSwapTx, describeFeePayer, estimateBuy, explainFailure, quoteTrade, swapDirection, type TradeAction, type TradeSide } from "@goalfi/chain/browser";
import { DEFAULT_SLIPPAGE_BPS, formatProbability, fromMicro, minOutWithSlippage, parseAmount, SLIPPAGE_PRESETS_BPS } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { explorerTx, friendlyError, useLiveMarket, useSendTx } from "./live-market";

const fmt = (micro: bigint | number, dp = 2) =>
  (Number(micro) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: Math.max(dp, 4) });

type Quote =
  | { amountIn: bigint; amountOut: bigint; key: string }
  | { error: string; key: string; /** Solana refused the test-run itself (not the market program): allow an estimate-based trade. */ runtime: boolean }
  | null;

export function TradePanel() {
  const { cfg, client, keys, view, holdings, rpcError, loaded, walletOk } = useLiveMarket();
  const wallet = useWallet();
  const [action, setAction] = useState<TradeAction>("BUY");
  const [side, setSide] = useState<TradeSide>("YES");
  const [input, setInput] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<Quote>(null);
  const [quoting, setQuoting] = useState(false);
  const { send, stage, result, clear } = useSendTx();

  const amount = parseAmount(input);
  const yes = view?.pool.yesPrice;
  const priceOf = (s: TradeSide) => (yes === undefined || !Number.isFinite(yes) ? null : s === "YES" ? yes : 1 - yes);
  const owned = holdings ? (side === "YES" ? holdings.yes : holdings.no) : null;
  const quoteKey = `${action}:${side}:${amount ?? 0}:${wallet.publicKey?.toBase58() ?? ""}`;

  // Instant, approximate estimate (fee included) for buys, from the SDK's curve math.
  const estimate = useMemo(() => (action === "BUY" && view && amount ? estimateBuy(view.pool, side === "YES" ? "yes" : "no", Number(amount)) : null), [action, side, amount, view]);

  // Exact quote: simulate the real swap transaction against the deployed program (debounced).
  useEffect(() => {
    setQuote(null);
    if (!amount || !wallet.publicKey || !walletOk || !view?.tradingOpen) return;
    const owner = wallet.publicKey;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await quoteTrade(client, { owner, keys, action, side, amountIn: amount });
        if (q.ok && q.amountOut > 0n) setQuote({ amountIn: amount, amountOut: q.amountOut, key: quoteKey });
        else if (q.runtimeError) {
          // Solana refused the test-run before the market program ran: diagnose the wallet account.
          const diag = await describeFeePayer(client.connection, owner).catch(() => "");
          setQuote({ error: `${explainFailure(q.error ?? "", q.logs, cfg.symbol)} (${q.error}) ${diag}`.trim(), key: quoteKey, runtime: true });
        } else setQuote({ error: q.error ? friendlyError({ message: q.logs.join("\n") || q.error, logs: q.logs }) : "No output", key: quoteKey, runtime: false });
      } catch (e) {
        setQuote({ error: friendlyError(e), key: quoteKey, runtime: false });
      } finally {
        setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, walletOk, view?.tradingOpen]);

  const validQuote = quote && "amountOut" in quote && quote.key === quoteKey ? quote : null;
  // Fallback when the exact test-run can't be done: protect a buy with the curve estimate minus slippage
  // and an extra 2% margin. The program enforces this minimum on-chain, and the wallet still simulates.
  const fallback = !validQuote && action === "BUY" && estimate && quote && "runtime" in quote && quote.runtime && quote.key === quoteKey;
  const minOut = validQuote
    ? minOutWithSlippage(validQuote.amountOut, slippage)
    : fallback ? minOutWithSlippage(BigInt(Math.floor(estimate!.sharesOut)), slippage + 200) : null;
  const overBalance = action === "SELL" && owned !== null && amount !== null && amount > owned;
  const overCollateral = action === "BUY" && holdings && amount !== null && amount > holdings.collateral;
  const maxTrade = BigInt(cfg.maxTradeMicro);
  const overLimit = action === "BUY" && amount !== null && amount > maxTrade;
  const noBlocked = action === "BUY" && side === "NO" && !!cfg.noBlockedReason;

  async function execute() {
    if (!wallet.publicKey || !amount || !minOut) return;
    const owner = wallet.publicKey;
    await send(
      () => buildSwapTx(client, { owner, keys, direction: swapDirection(action, side), amountIn: amount, minOutput: minOut }),
      `${action}_${side}` as "BUY_YES",
      `${action === "BUY" ? "Buy" : "Sell"} ${side}`,
      action === "BUY" ? amount : undefined,
    );
    setInput("");
  }

  if (view?.resolved || cfg.winningOutcome) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-5 text-sm">
          <p className="font-medium">Trading is closed. This market is resolved.</p>
          <p className="text-muted-foreground">If you hold winning shares, claim them in <b>Your position</b>. Payouts go straight from the pm-AMM market to your wallet.</p>
          {!wallet.connected && cfg.linkedWallet && <WalletButton style={{ height: 40, borderRadius: 8, fontSize: 14 }} />}
        </CardContent>
      </Card>
    );
  }

  let gate: React.ReactNode = null;
  if (!loaded) gate = <p className="text-sm text-muted-foreground">Loading on-chain market…</p>;
  else if (rpcError) gate = <p className="text-sm text-warning">{rpcError}</p>;
  else if (view && !view.tradingOpen)
    gate = <p className="text-sm text-muted-foreground">{view.resolved ? "This market is resolved. Trading is closed." : !view.hasLiquidity ? "This market has no liquidity yet." : "Trading closed at the challenge end date. The market resolves after verification."}</p>;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-2 rounded-md bg-muted p-1 text-sm font-medium" role="tablist" aria-label="Trade direction">
          {(["BUY", "SELL"] as const).map((a) => (
            <button key={a} role="tab" aria-selected={action === a} onClick={() => { setAction(a); setInput(""); clear(); }}
              className={cn("rounded px-3 py-1.5", action === a ? "bg-card shadow-xs" : "text-muted-foreground")}>
              {a === "BUY" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(["YES", "NO"] as const).map((s) => (
            <button key={s} onClick={() => { setSide(s); clear(); }} aria-pressed={side === s} title={s === "NO" && action === "BUY" && cfg.noBlockedReason ? cfg.noBlockedReason : undefined}
              className={cn("rounded-md border-2 px-3 py-2.5 text-left transition-colors",
                side === s ? (s === "YES" ? "border-yes bg-yes-soft" : "border-no bg-no-soft") : "border-transparent bg-muted")}>
              <div className={cn("text-sm font-semibold", s === "YES" ? "text-yes" : "text-no")}>{s}</div>
              <div className="text-lg font-semibold tabular">{priceOf(s) === null ? "—" : formatProbability(priceOf(s)!)}</div>
            </button>
          ))}
        </div>

        {cfg.easyToGame && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"><b>Easier to game.</b> {cfg.easyToGame}</p>}
        {noBlocked ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" role="note">{cfg.noBlockedReason}</p>
        ) : gate ?? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="amt" className="font-medium">{action === "BUY" ? `Amount (${cfg.symbol})` : `${side} shares to sell`}</label>
                {holdings && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setInput(fromMicro(action === "BUY" ? holdings.collateral : owned ?? 0n))}>
                    {action === "BUY" ? `Balance ${fmt(holdings.collateral)} ${cfg.symbol}` : `You hold ${fmt(owned ?? 0n)}`} · Max
                  </button>
                )}
              </div>
              <input id="amt" inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} onChange={(e) => setInput(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-card px-3 text-lg tabular" />
              {action === "BUY" && (
                <div className="flex gap-1.5">
                  {[5, 10, 25, 100].map((v) => <button key={v} type="button" onClick={() => setInput(String(v))} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">{v}</button>)}
                </div>
              )}
            </div>

            {amount && (
              <dl className="space-y-1.5 rounded-md bg-muted p-3 text-sm tabular">
                {action === "BUY" && estimate && (
                  <>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Est. shares</dt><dd>{fmt(validQuote?.amountOut ?? BigInt(Math.floor(estimate.sharesOut)))}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Avg. price</dt><dd>{formatProbability(validQuote ? Number(amount) / Number(validQuote.amountOut) : estimate.avgPrice)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{side} price after</dt><dd>{formatProbability(side === "YES" ? estimate.priceAfter : 1 - estimate.priceAfter)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Fee (2%)</dt><dd>{fmt(estimate.feeMicro)} {cfg.symbol}</dd></div>
                    <div className="flex justify-between font-medium"><dt>Pays if {side} wins</dt><dd>{fmt(validQuote?.amountOut ?? BigInt(Math.floor(estimate.sharesOut)))} {cfg.symbol}</dd></div>
                  </>
                )}
                {action === "SELL" && (
                  <div className="flex justify-between"><dt className="text-muted-foreground">You receive (after 2% fee)</dt><dd>{validQuote ? `${fmt(validQuote.amountOut)} ${cfg.symbol}` : "—"}</dd></div>
                )}
                {minOut !== null && (
                  <div className="flex justify-between"><dt className="text-muted-foreground">Minimum ({slippage / 100}% slippage)</dt><dd>{fmt(minOut)} {action === "BUY" ? "shares" : cfg.symbol}</dd></div>
                )}
                <div className="pt-1 text-xs text-muted-foreground">
                  {quoting ? "Simulating against the pm-AMM program…" : validQuote ? "✓ Exact quote simulated against the deployed program." : quote && "error" in quote ? <span className="text-no">Quote failed: {quote.error}{fallback && <span className="block text-muted-foreground">You can still buy with the estimated minimum below; Phantom checks the real transaction before you sign.</span>}</span> : action === "BUY" ? "Estimate from curve math. Connect your linked wallet for an exact quote." : "Connect your linked wallet for a quote."}
                </div>
              </dl>
            )}

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Slippage
              {SLIPPAGE_PRESETS_BPS.map((b) => (
                <button key={b} onClick={() => setSlippage(b)} className={cn("rounded-full border px-2 py-0.5", slippage === b && "border-primary text-primary")}>{b / 100}%</button>
              ))}
            </div>

            {!cfg.signedIn ? (
              <Button asChild className="w-full"><Link href="/login">Sign in to trade</Link></Button>
            ) : !cfg.linkedWallet ? (
              <Button asChild className="w-full"><Link href="/settings#wallet">Link a wallet to trade</Link></Button>
            ) : !wallet.connected ? (
              <WalletButton style={{ width: "100%", justifyContent: "center", height: 44, borderRadius: 8 }} />
            ) : !walletOk ? (
              <p className="text-sm text-warning">Switch to your linked wallet ({cfg.linkedWallet.slice(0, 4)}…{cfg.linkedWallet.slice(-4)}) so the trade is credited to your account.</p>
            ) : (
              <Button className="w-full" size="lg" variant={side === "YES" ? "yes" : "no"} onClick={execute}
                disabled={(!validQuote && !fallback) || !minOut || !!stage || !!overBalance || !!overCollateral || overLimit}>
                {stage ?? (overLimit ? `Max ${fromMicro(maxTrade)} ${cfg.symbol} per trade` : overBalance ? "Not enough shares" : overCollateral ? `Not enough ${cfg.symbol}` : fallback ? `Buy ${side} (estimated minimum)` : `${action === "BUY" ? "Buy" : "Sell"} ${side}`)}
              </Button>
            )}
          </>
        )}

        {result && (
          <div className={cn("rounded-md px-3 py-2 text-sm", result.ok ? "bg-yes-soft text-yes" : "bg-no-soft text-no")} role="status">
            {result.text}
            {result.sig && <> <a className="underline" href={explorerTx(cfg.cluster, result.sig)} target="_blank" rel="noreferrer">View transaction</a></>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Trades execute on the Predict pm-AMM program and are signed in your wallet. GoalFi never holds your funds.</p>
      </CardContent>
    </Card>
  );
}
