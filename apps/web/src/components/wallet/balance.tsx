"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";

/** Live on-chain collateral balance (USDC on mainnet, mUSDC on devnet) for an address. */
export function CollateralBalance({ owner, mint, symbol }: { owner: string; mint: string; symbol: string }) {
  const { connection } = useConnection();
  const [state, setState] = useState<{ v?: string; err?: string }>({});
  useEffect(() => {
    let live = true;
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner));
    connection
      .getTokenAccountBalance(ata, "confirmed")
      .then((b) => live && setState({ v: b.value.uiAmountString ?? "0" }))
      .catch((e: Error) => live && setState(/could not find account|Invalid param/i.test(e.message) ? { v: "0" } : { err: "Could not reach Solana RPC" }));
    return () => { live = false; };
  }, [connection, owner, mint]);
  if (state.err) return <span className="text-sm text-muted-foreground">{state.err}</span>;
  if (state.v === undefined) return <span className="text-sm text-muted-foreground">Loading…</span>;
  return <span className="tabular">{Number(state.v).toLocaleString("en-US", { maximumFractionDigits: 2 })} {symbol}</span>;
}
