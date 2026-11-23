import { PublicKey } from "@solana/web3.js";
import {
  authorityContext,
  chainConfigFromEnv,
  createBinaryMarket,
  explorerTxUrl,
  fetchMarketView,
  loadAuthorityKeypair,
  makeConnection,
  newOnchainId,
  readHoldings,
  resolveBinaryMarket,
  verifyProgramTransaction,
} from "@goalfi/chain/server";
import type { MarketGateway, OnchainMarketState } from "./gateway";

/**
 * Production MarketGateway backed by the real pm-AMM program via @goalfi/chain + @pm-amm/sdk.
 * Returns null when no market authority key is configured (market features then report 503).
 */
export function createChainGateway(env: Record<string, string | undefined> = process.env): MarketGateway | null {
  if (!env.GOALFI_MARKET_AUTHORITY_SECRET) return null;
  const cfg = chainConfigFromEnv(env);
  const connection = makeConnection(cfg);
  const keypair = loadAuthorityKeypair(env.GOALFI_MARKET_AUTHORITY_SECRET);
  const ctx = authorityContext(cfg, connection, keypair);
  const client = ctx.client;

  const view = async (address: string): Promise<OnchainMarketState | null> => {
    const v = await fetchMarketView(client, address);
    if (!v) return null;
    return {
      address: v.address, resolved: v.resolved, winningSide: v.winningSide, endTs: v.endTs, hasLiquidity: v.hasLiquidity,
      yesPrice: v.pool.yesPrice, reserveYes: v.pool.reserveYes, reserveNo: v.pool.reserveNo, lEff: v.pool.lEff, poolValue: v.pool.poolValue,
    };
  };

  return {
    cluster: cfg.dbCluster,
    programId: cfg.programId.toBase58(),
    collateralMint: cfg.collateralMint.toBase58(),
    collateralSymbol: cfg.collateralSymbol,
    authority: keypair.publicKey.toBase58(),
    newOnchainId,
    marketAddressFor: (id) => client.marketPda(id).toBase58(),
    async createBinaryMarket(p, onSigned) {
      const r = await createBinaryMarket(ctx, p, onSigned);
      return { address: r.market.toBase58(), signature: r.signature };
    },
    async resolveBinaryMarket(p, onSigned) {
      const r = await resolveBinaryMarket(ctx, { market: new PublicKey(p.address), side: p.side }, onSigned);
      return { signature: r.signature };
    },
    fetchMarket: view,
    async verifyUserTx(signature, p) {
      const market = new PublicKey(p.market);
      const owner = new PublicKey(p.owner);
      const r = await verifyProgramTransaction(connection, signature, { programId: cfg.programId, owner, mustInclude: [market] });
      if (r.status !== "CONFIRMED") return { status: r.status, reason: "reason" in r ? r.reason : undefined, slot: "slot" in r ? r.slot : undefined };
      const by = r.ownerDeltas;
      return {
        status: "CONFIRMED",
        slot: r.slot,
        deltas: {
          collateral: by[cfg.collateralMint.toBase58()] ?? 0n,
          yes: by[client.yesMint(market).toBase58()] ?? 0n,
          no: by[client.noMint(market).toBase58()] ?? 0n,
        },
      };
    },
    async readHoldings(p) {
      const h = await readHoldings(client, { market: new PublicKey(p.market), authority: keypair.publicKey, collateralMint: cfg.collateralMint }, new PublicKey(p.owner));
      return { yes: h.yes, no: h.no };
    },
    explorerTxUrl: (sig) => explorerTxUrl(cfg, sig),
  };
}
