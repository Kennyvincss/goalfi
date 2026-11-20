/**
 * Live devnet end-to-end test of the full pm-AMM loop GoalFi depends on:
 *   create market (platform authority) → seed liquidity → simulated quote → buy YES → sell part
 *   → wait for expiry → resolve → claim winnings.
 * It also verifies two facts the SDK does not document:
 *   1. curve orientation: price at open ≈ initial_price_bps
 *   2. Market.winning_side encoding after resolve_market(Yes)
 *
 * Usage:  pnpm --filter @goalfi/chain devnet:e2e
 * Keys:   .devnet-keys/authority.json and .devnet-keys/trader.json (created by `pnpm keygen`),
 *         or GOALFI_MARKET_AUTHORITY_SECRET for the authority.
 * Funds:  both keys need devnet SOL; authority needs ≥ 25 mUSDC and trader ≥ 5 mUSDC.
 */
import fs from "node:fs";
import path from "node:path";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  assertClusterMatches,
  authorityContext,
  buildClaimWinningsTx,
  buildDepositLiquidityTx,
  buildSwapTx,
  chainConfig,
  createBinaryMarket,
  explorerTxUrl,
  fetchMarketView,
  loadAuthorityKeypair,
  makeConnection,
  newOnchainId,
  quoteTrade,
  readHoldings,
  readOnlyClient,
  resolveBinaryMarket,
  verifyProgramTransaction,
  type MarketKeys,
} from "../src/server";

const KEY_DIR = path.resolve(__dirname, "../../../.devnet-keys");
const SEED_BPS = 6800;

function loadKey(name: string): Keypair {
  if (name === "authority" && process.env.GOALFI_MARKET_AUTHORITY_SECRET)
    return loadAuthorityKeypair(process.env.GOALFI_MARKET_AUTHORITY_SECRET);
  const file = path.join(KEY_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — run: pnpm --filter @goalfi/chain keygen`);
  return Keypair.fromSecretKey(bs58.decode(JSON.parse(fs.readFileSync(file, "utf8")).secret));
}

async function sendUserTx(connection: Connection, tx: Transaction, kp: Keypair): Promise<string> {
  tx.sign(kp);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, "confirmed");
  return sig;
}

async function ensureSol(connection: Connection, pk: PublicKey, label: string) {
  const bal = await connection.getBalance(pk);
  if (bal >= 0.05 * LAMPORTS_PER_SOL) return;
  console.log(`  ${label}: requesting devnet SOL airdrop…`);
  try {
    const sig = await connection.requestAirdrop(pk, 1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  } catch (e) {
    throw new Error(`${label} ${pk.toBase58()} needs devnet SOL (airdrop failed: ${(e as Error).message}). Use https://faucet.solana.com`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = {};
function check(name: string, ok: boolean, detail: unknown) {
  results[name] = { ok, detail };
  console.log(`${ok ? "✅" : "❌"} ${name}`, detail);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const cfg = chainConfig("devnet", process.env.GOALFI_RPC_URL ?? "https://api.devnet.solana.com");
  const connection = makeConnection(cfg);
  await assertClusterMatches(connection, cfg);
  const authority = loadKey("authority");
  const trader = loadKey("trader");
  console.log("authority", authority.publicKey.toBase58(), "\ntrader   ", trader.publicKey.toBase58());
  await ensureSol(connection, authority.publicKey, "authority");
  await ensureSol(connection, trader.publicKey, "trader");

  const ctx = authorityContext(cfg, connection, authority);
  const client = readOnlyClient(cfg, connection);

  // 1. Create market — closes in 6 minutes (program minimum is 5).
  const onchainId = newOnchainId();
  const endTs = new Date(Date.now() + 6 * 60_000);
  const created = await createBinaryMarket(ctx, { onchainId, endTs, name: "GoalFi devnet e2e", initialPriceBps: SEED_BPS });
  const keys: MarketKeys = { market: created.market, authority: authority.publicKey, collateralMint: cfg.collateralMint };
  check("create_market", created.view.authority === authority.publicKey.toBase58(), {
    market: created.market.toBase58(), tx: created.signature && explorerTxUrl(cfg, created.signature),
  });

  // 2. Seed liquidity (creator-funded) — here the authority plays the creator.
  const seedTx = await buildDepositLiquidityTx(client, { owner: authority.publicKey, keys, amount: 20_000_000n });
  const seedSig = await sendUserTx(connection, seedTx, authority);
  const v1 = (await fetchMarketView(client, created.market))!;
  check("seed_price_matches_initial_price_bps", Math.abs(v1.pool.yesPrice - SEED_BPS / 10_000) < 0.01, {
    yesPrice: v1.pool.yesPrice, expected: SEED_BPS / 10_000, lEff: v1.pool.lEff, tx: explorerTxUrl(cfg, seedSig),
  });
  // Report how implied L_eff relates to L₀·√(T−t) for each candidate time unit.
  const acc = (await client.fetchMarket(created.market))!;
  const { i80f48ToNumber } = await import("@pm-amm/sdk/math");
  const l0 = i80f48ToNumber(acc.lZero);
  const remaining = Number(acc.endTs.toString()) - Number(acc.lastAccrualTs.toString());
  results.lEffUnits = { l0, impliedLEff: v1.pool.lEff, secs: l0 * Math.sqrt(remaining), days: l0 * Math.sqrt(remaining / 86_400) };
  console.log("ℹ️  L_eff unit probe", results.lEffUnits);

  // 3. Quote via simulation, then buy YES with 1% slippage.
  const amountIn = 2_000_000n;
  const q = await quoteTrade(client, { owner: trader.publicKey, keys, action: "BUY", side: "YES", amountIn });
  check("simulated_quote", q.ok && q.amountOut > 0n, { amountOut: q.amountOut.toString(), error: q.error });
  const minOut = (q.amountOut * 99n) / 100n;
  const buyTx = await buildSwapTx(client, { owner: trader.publicKey, keys, direction: "usdcToYes", amountIn, minOutput: minOut });
  const buySig = await sendUserTx(connection, buyTx, trader);
  const ver = await verifyProgramTransaction(connection, buySig, { programId: cfg.programId, owner: trader.publicKey, mustInclude: [created.market] });
  const h1 = await readHoldings(client, keys, trader.publicKey);
  check("buy_yes", ver.status === "CONFIRMED" && h1.yes >= minOut, {
    yes: h1.yes.toString(), quoted: q.amountOut.toString(), verify: ver.status, tx: explorerTxUrl(cfg, buySig),
  });
  const v2 = (await fetchMarketView(client, created.market))!;
  check("price_moved_up_after_buy_yes", v2.pool.yesPrice > v1.pool.yesPrice, { before: v1.pool.yesPrice, after: v2.pool.yesPrice });

  // 4. Sell a quarter of the YES back.
  const sellAmt = h1.yes / 4n;
  const sq = await quoteTrade(client, { owner: trader.publicKey, keys, action: "SELL", side: "YES", amountIn: sellAmt });
  const sellTx = await buildSwapTx(client, { owner: trader.publicKey, keys, direction: "yesToUsdc", amountIn: sellAmt, minOutput: (sq.amountOut * 99n) / 100n });
  const sellSig = await sendUserTx(connection, sellTx, trader);
  const h2 = await readHoldings(client, keys, trader.publicKey);
  check("sell_yes", h2.yes === h1.yes - sellAmt && h2.collateral > h1.collateral, { usdcBack: (h2.collateral - h1.collateral).toString(), tx: explorerTxUrl(cfg, sellSig) });

  // 5. Wait for expiry, then resolve YES.
  const wait = endTs.getTime() - Date.now() + 15_000;
  console.log(`⏳ waiting ${Math.ceil(wait / 1000)}s for market expiry…`);
  await sleep(Math.max(0, wait));
  const res = await resolveBinaryMarket(ctx, { market: created.market, side: "YES" });
  check("resolve_market", res.view.resolved, { winningSideRaw: res.view.winningSideRaw, decoded: res.view.winningSide, tx: res.signature && explorerTxUrl(cfg, res.signature) });
  check("winning_side_encoding_yes_is_1", res.view.winningSideRaw === 1, { raw: res.view.winningSideRaw });

  // 6. Claim winnings: trader receives 1 USDC per YES.
  const claimTx = await buildClaimWinningsTx(client, { owner: trader.publicKey, keys });
  const claimSig = await sendUserTx(connection, claimTx, trader);
  const h3 = await readHoldings(client, keys, trader.publicKey);
  check("claim_winnings", h3.yes === 0n && h3.collateral - h2.collateral === h2.yes, {
    paid: (h3.collateral - h2.collateral).toString(), expected: h2.yes.toString(), tx: explorerTxUrl(cfg, claimSig),
  });

  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(path.join(KEY_DIR, `e2e-${Date.now()}.json`), JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
