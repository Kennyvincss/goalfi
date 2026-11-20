import { PublicKey, type Connection } from "@solana/web3.js";
import { PmAmmClient, decodeName, type MarketAccount } from "@pm-amm/sdk";
import type { ChainConfig } from "./config";
import { poolStateFromRaw, type PoolState } from "./curve";

export function readOnlyClient(cfg: ChainConfig, connection: Connection): PmAmmClient {
  return PmAmmClient.readOnly(connection, cfg.programId, cfg.collateralMint);
}

export type WinningSide = "YES" | "NO" | "UNKNOWN";

/**
 * Decode `Market.winning_side` (u8). The SDK documents bet vaults as 0 = unsettled, 1 = YES, 2 = NO,
 * and Market stores the same field without docs. Treat {1,2} as YES/NO, and anything else on a
 * resolved market as UNKNOWN (callers fall back to the outcome GoalFi recorded when it resolved).
 * [VERIFY ON DEVNET] — asserted by scripts/devnet-e2e.ts.
 */
export function decodeWinningSide(resolved: boolean, raw: number): WinningSide | null {
  if (!resolved) return null;
  if (raw === 1) return "YES";
  if (raw === 2) return "NO";
  return "UNKNOWN";
}

export interface MarketView {
  address: string;
  onchainId: string;
  name: string;
  authority: string;
  collateralMint: string;
  yesMint: string;
  noMint: string;
  vault: string;
  startTs: number;
  endTs: number;
  initialPriceBps: number;
  resolved: boolean;
  winningSideRaw: number;
  winningSide: WinningSide | null;
  hasLiquidity: boolean;
  totalLpShares: string;
  pool: PoolState;
  /** Trading is disabled on-chain once end_ts passes (MarketExpired). */
  tradingOpen: boolean;
  group: string | null;
}

export function toMarketView(address: PublicKey, m: MarketAccount, nowSecs = Math.floor(Date.now() / 1000)): MarketView {
  const pool = poolStateFromRaw(m.reserveYes, m.reserveNo);
  const endTs = Number(m.endTs.toString());
  const group = m.group && !m.group.equals(PublicKey.default) ? m.group.toBase58() : null;
  const hasLiquidity = pool.lEff > 0;
  return {
    address: address.toBase58(),
    onchainId: m.marketId.toString(),
    name: decodeName(m.name),
    authority: m.authority.toBase58(),
    collateralMint: m.collateralMint.toBase58(),
    yesMint: m.yesMint.toBase58(),
    noMint: m.noMint.toBase58(),
    vault: m.vault.toBase58(),
    startTs: Number(m.startTs.toString()),
    endTs,
    initialPriceBps: m.initialPriceBps,
    resolved: m.resolved,
    winningSideRaw: m.winningSide,
    winningSide: decodeWinningSide(m.resolved, m.winningSide),
    hasLiquidity,
    totalLpShares: m.totalLpShares.toString(),
    pool,
    tradingOpen: !m.resolved && hasLiquidity && nowSecs < endTs,
    group,
  };
}

export async function fetchMarketView(client: PmAmmClient, address: PublicKey | string): Promise<MarketView | null> {
  const pk = typeof address === "string" ? new PublicKey(address) : address;
  const m = await client.fetchMarket(pk);
  return m ? toMarketView(pk, m) : null;
}

/** Batch-read several markets in one RPC round trip. */
export async function fetchMarketViews(client: PmAmmClient, addresses: string[]): Promise<Map<string, MarketView>> {
  const out = new Map<string, MarketView>();
  if (addresses.length === 0) return out;
  const pks = addresses.map((a) => new PublicKey(a));
  const accounts = await client.program.account.market.fetchMultiple(pks);
  accounts.forEach((acc, i) => {
    if (acc) out.set(addresses[i]!, toMarketView(pks[i]!, acc as unknown as MarketAccount));
  });
  return out;
}
