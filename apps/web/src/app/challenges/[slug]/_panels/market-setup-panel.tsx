"use client";

import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/wallet/wallet-button";
import { buildDepositLiquidityTx, PmAmmClient, preflightTransaction } from "@goalfi/chain/browser";
import { friendlyError } from "@/app/markets/[slug]/live-market";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAction } from "./use-action";

interface Props {
  challengeId: string;
  marketId: string;
  status: string;
  lastError: string | null;
  marketAddress: string | null;
  authority: string;
  programId: string;
  collateralMint: string;
  collateralSymbol: string;
  fundedMicro: string;
  targetMicro: string;
  canManage: boolean;
  isCreator: boolean;
  linkedWallet: string | null;
}

/** Shown while a challenge's market is being created or waiting for initial liquidity. */
export function MarketSetupPanel(p: Props) {
  const { run, busy, error, setError } = useAction();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [stage, setStage] = useState<string | null>(null);
  const funded = Number(p.fundedMicro) / 1e6;
  const target = Number(p.targetMicro) / 1e6;
  const remaining = Math.max(0, target - funded);
  const [amount, setAmount] = useState(remaining);
  const client = useMemo(() => PmAmmClient.readOnly(connection, new PublicKey(p.programId), new PublicKey(p.collateralMint)), [connection, p.programId, p.collateralMint]);
  const walletMatches = wallet.publicKey && p.linkedWallet === wallet.publicKey.toBase58();

  async function fund() {
    if (!wallet.publicKey || !p.marketAddress) return;
    setError(null);
    try {
      setStage("Preparing transaction…");
      const tx = await buildDepositLiquidityTx(client, {
        owner: wallet.publicKey,
        keys: { market: new PublicKey(p.marketAddress), authority: new PublicKey(p.authority), collateralMint: new PublicKey(p.collateralMint) },
        amount: BigInt(Math.round(amount * 1e6)),
      });
      setStage("Checking your wallet…");
      const problem = await preflightTransaction(connection, wallet.publicKey, tx, {
        spend: { mint: new PublicKey(p.collateralMint), amountMicro: BigInt(Math.round(amount * 1e6)), symbol: p.collateralSymbol },
      });
      if (problem) {
        setError(problem);
        return;
      }
      setStage("Approve in your wallet…");
      const signature = await wallet.sendTransaction(tx, connection);
      setStage("Confirming on Solana…");
      await connection.confirmTransaction({ signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, "confirmed");
      setStage("Verifying…");
      await run("/api/transactions", { json: { signature, marketId: p.marketId, kind: "DEPOSIT_LIQUIDITY" } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setStage(null);
    }
  }

  if (p.status === "CREATING") {
    return (
      <div className="space-y-3 rounded-lg border p-5">
        <h2 className="font-semibold">Creating the on-chain market</h2>
        {p.lastError ? <p className="text-sm text-no">Last attempt failed: {p.lastError}</p> : <p className="text-sm text-muted-foreground">Waiting for Solana confirmation…</p>}
        {p.canManage && <Button onClick={() => run(`/api/challenges/${p.challengeId}/retry-market`)} disabled={busy}>{busy ? "Retrying…" : "Retry market creation"}</Button>}
        {error && <p className="text-sm text-no">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="font-semibold">Fund the market to go live</h2>
        <p className="mt-1 text-sm text-muted-foreground">The market exists on-chain. The challenge is published once {target} {p.collateralSymbol} of initial liquidity is confirmed.</p>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm tabular"><span>{funded.toLocaleString()} / {target.toLocaleString()} {p.collateralSymbol}</span><span>{Math.round((funded / target) * 100)}%</span></div>
        <Progress value={target ? funded / target : 0} tone="yes" />
      </div>
      {p.isCreator ? (
        <div className="space-y-3">
          <WalletButton style={{ height: 40, borderRadius: 8, fontSize: 14 }} />
          {wallet.connected && !walletMatches && <p className="text-sm text-warning">Connect the wallet linked to your account ({p.linkedWallet ?? "none: link one in Settings"}).</p>}
          {walletMatches && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" min={1} step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-10 w-32 rounded-md border bg-card px-3 text-sm" aria-label={`Amount in ${p.collateralSymbol}`} />
              <Button onClick={fund} disabled={!!stage || busy || amount <= 0}>{stage ?? `Deposit ${p.collateralSymbol}`}</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Deposits go straight into the pm-AMM pool via the official SDK. You receive LP shares and can withdraw remaining liquidity later.</p>
        </div>
      ) : <p className="text-sm text-muted-foreground">Waiting for the creator to fund the market.</p>}
      {error && <p className="text-sm text-no" role="alert">{error}</p>}
    </div>
  );
}
