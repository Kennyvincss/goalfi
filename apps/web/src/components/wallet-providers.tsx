"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";

export const PUBLIC_RPC = process.env.NEXT_PUBLIC_GOALFI_RPC_URL ?? "https://api.devnet.solana.com";

export function WalletProviders({ children }: { children: ReactNode }) {
  // Wallet Standard wallets (Phantom, Solflare, Backpack…) are auto-detected; explicit adapters
  // cover older extension versions and Solflare's web wallet.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={PUBLIC_RPC} config={{ commitment: "confirmed" }}>
      {/* autoConnect: picking a wallet in the modal connects immediately, and returning users reconnect. */}
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
