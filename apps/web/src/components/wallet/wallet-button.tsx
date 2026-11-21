"use client";

import dynamic from "next/dynamic";

/**
 * Client-only wallet button. With autoConnect the label depends on the wallet remembered in
 * localStorage, which the server can't know; rendering it on the server causes a hydration mismatch.
 */
export const WalletButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <div className="h-10 w-40 animate-pulse rounded-lg bg-muted" aria-hidden /> },
);
