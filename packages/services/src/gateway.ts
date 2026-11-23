/**
 * The only seam between business services and Solana. Production uses `createChainGateway()`
 * (./chain-gateway.ts, built on @goalfi/chain + @pm-amm/sdk). Tests inject an in-memory
 * implementation. Services never import the SDK directly.
 */
export interface OnchainMarketState {
  address: string;
  resolved: boolean;
  winningSide: "YES" | "NO" | "UNKNOWN" | null;
  endTs: number;
  hasLiquidity: boolean;
  yesPrice: number;
  reserveYes: number;
  reserveNo: number;
  lEff: number;
  poolValue: number;
}

export interface UserTxResult {
  status: "PENDING" | "FAILED" | "CONFIRMED";
  reason?: string;
  slot?: number;
  /** Net balance changes of the signer for this market's collateral / YES / NO (micro-units). */
  deltas?: { collateral: bigint; yes: bigint; no: bigint };
}

export interface MarketGateway {
  readonly cluster: "DEVNET" | "MAINNET";
  readonly programId: string;
  readonly collateralMint: string;
  readonly collateralSymbol: string;
  readonly authority: string;
  newOnchainId(): bigint;
  marketAddressFor(onchainId: bigint): string;
  createBinaryMarket(
    p: { onchainId: bigint; endTs: Date; name: string; initialPriceBps: number },
    onSigned: (signature: string) => Promise<void>,
  ): Promise<{ address: string; signature: string | null }>;
  resolveBinaryMarket(
    p: { address: string; side: "YES" | "NO" },
    onSigned: (signature: string) => Promise<void>,
  ): Promise<{ signature: string | null }>;
  fetchMarket(address: string): Promise<OnchainMarketState | null>;
  verifyUserTx(signature: string, p: { owner: string; market: string }): Promise<UserTxResult>;
  /** YES / NO shares a wallet currently holds on a market (micro-units). */
  readHoldings(p: { owner: string; market: string }): Promise<{ yes: bigint; no: bigint }>;
  explorerTxUrl(signature: string): string;
}
