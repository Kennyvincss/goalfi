"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { fetchMarketView, mapAnchorError, PmAmmClient, preflightTransaction, readHoldings, type MarketKeys, type MarketView } from "@goalfi/chain/browser";

export interface MarketCfg {
  marketId: string;
  marketAddress: string;
  authority: string;
  programId: string;
  collateralMint: string;
  symbol: string;
  cluster: "DEVNET" | "MAINNET";
  linkedWallet: string | null;
  signedIn: boolean;
  /** Outcome recorded by GoalFi when it resolved the market (source of truth for display). */
  winningOutcome: "YES" | "NO" | null;
  /** Set when the viewer hosts the challenge (creator or co-admin): they may not buy at all, only sell. */
  buyBlockedReason: string | null;
  /** Set when the viewer takes part in the challenge: they may only buy YES here. */
  noBlockedReason: string | null;
  /** Largest single buy GoalFi's screen allows (micro-units, as a string). */
  maxTradeMicro: string;
  /** Why this market is easier to manipulate, if it is. */
  easyToGame: string | null;
}

interface Holdings { collateral: bigint; yes: bigint; no: bigint }

interface LiveState {
  cfg: MarketCfg;
  client: PmAmmClient;
  keys: MarketKeys;
  view: MarketView | null;
  holdings: Holdings | null;
  rpcError: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Connected wallet is the one linked to the GoalFi account (required for trades to be credited). */
  walletOk: boolean;
}

const Ctx = createContext<LiveState | null>(null);

export function useLiveMarket(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveMarket outside LiveMarketProvider");
  return v;
}

export function explorerTx(cluster: MarketCfg["cluster"], sig: string) {
  return `https://solscan.io/tx/${sig}${cluster === "DEVNET" ? "?cluster=devnet" : ""}`;
}

/** Live on-chain market state + the connected wallet's balances, polled every 15 s. */
export function LiveMarketProvider({ cfg, children }: { cfg: MarketCfg; children: ReactNode }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const client = useMemo(() => PmAmmClient.readOnly(connection, new PublicKey(cfg.programId), new PublicKey(cfg.collateralMint)), [connection, cfg.programId, cfg.collateralMint]);
  const keys = useMemo<MarketKeys>(() => ({ market: new PublicKey(cfg.marketAddress), authority: new PublicKey(cfg.authority), collateralMint: new PublicKey(cfg.collateralMint) }), [cfg.marketAddress, cfg.authority, cfg.collateralMint]);
  const [view, setView] = useState<MarketView | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [v, h] = await Promise.all([fetchMarketView(client, keys.market), publicKey ? readHoldings(client, keys, publicKey) : Promise.resolve(null)]);
      setView(v);
      setHoldings(h);
      setRpcError(v ? null : "Market account not found on-chain");
    } catch {
      setRpcError("Could not reach the Solana RPC. Live prices and trading are unavailable right now.");
    } finally {
      setLoaded(true);
    }
  }, [client, keys, publicKey]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const walletOk = !!publicKey && publicKey.toBase58() === cfg.linkedWallet;
  return <Ctx.Provider value={{ cfg, client, keys, view, holdings, rpcError, loaded, refresh, walletOk }}>{children}</Ctx.Provider>;
}

const FRIENDLY: Record<string, string> = {
  SlippageExceeded: "Price moved beyond your slippage tolerance. Try again or increase slippage.",
  InsufficientOutput: "Price moved beyond your slippage tolerance. Try again or increase slippage.",
  MarketExpired: "Trading for this market has closed.",
  MarketAlreadyResolved: "This market is already resolved.",
  MarketNotResolved: "This market hasn't been resolved yet.",
  InsufficientBalance: "Insufficient token balance.",
  InsufficientLiquidity: "Not enough liquidity or balance for this trade.",
};

export function friendlyError(e: unknown): string {
  const mapped = mapAnchorError(e);
  if (mapped) return FRIENDLY[mapped.name] ?? mapped.msg ?? mapped.name;
  // Wallet adapters wrap the wallet's own error: look inside for the real message.
  const inner = (e as { error?: { message?: string } })?.error?.message;
  const msg = [(e as Error)?.message, inner].filter(Boolean).join(" ") || String(e);
  if (/User rejected|rejected the request|cancel/i.test(msg)) return "You cancelled the transaction in your wallet.";
  if (/insufficient lamports|insufficient funds for fee|no record of a prior credit/i.test(msg)) return "Your wallet needs a little devnet SOL for network fees. Get some free at faucet.solana.com.";
  if (/Unexpected error|simulation failed/i.test(msg))
    return "Your wallet refused the transaction. Check that Phantom is on Devnet (Settings → Developer Settings → Testnet Mode → Solana Devnet) and that you have devnet SOL and enough test USDC.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

export type TxKind = "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO" | "CLAIM_WINNINGS" | "REDEEM_PAIR";

/** Build → sign in wallet → confirm on-chain → report to GoalFi for verification. */
export function useSendTx() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const router = useRouter();
  const { cfg, refresh } = useLiveMarket();
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  async function send(build: () => Promise<Transaction>, kind: TxKind, label: string, spendMicro?: bigint) {
    setResult(null);
    let sig: string | undefined;
    try {
      setStage("Preparing…");
      const tx = await build();
      setStage("Checking your wallet…");
      const problem = await preflightTransaction(connection, wallet.publicKey!, tx, {
        symbol: cfg.symbol,
        ...(spendMicro ? { spend: { mint: new PublicKey(cfg.collateralMint), amountMicro: spendMicro, symbol: cfg.symbol } } : {}),
      });
      if (problem) {
        setResult({ ok: false, text: problem });
        return;
      }
      setStage("Approve in your wallet…");
      sig = await wallet.sendTransaction(tx, connection);
      setStage("Confirming on Solana…");
      const conf = await connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, "confirmed");
      if (conf.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(conf.value.err)}`);
      setStage("Recording…");
      const r = await fetch("/api/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: sig, marketId: cfg.marketId, kind }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setResult({ ok: false, text: `${label} confirmed on-chain, but GoalFi couldn’t record it: ${d.error ?? r.status}`, sig });
      else if (d.status === "PENDING") setResult({ ok: true, text: `${label} confirmed on-chain. GoalFi is still indexing it.`, sig });
      else if (d.status === "FAILED") setResult({ ok: false, text: `${label} could not be verified: ${d.error}`, sig });
      else setResult({ ok: true, text: `${label} confirmed.`, sig });
      await refresh();
      router.refresh();
    } catch (e) {
      setResult({ ok: false, text: friendlyError(e), sig });
    } finally {
      setStage(null);
    }
  }
  return { send, stage, result, clear: () => setResult(null) };
}
