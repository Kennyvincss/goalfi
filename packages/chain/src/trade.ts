import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  VersionedMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { CU, PROTOCOL_DAO, type PmAmmClient, type SwapDirection } from "@pm-amm/sdk";

/**
 * Transaction builders for user-signed actions. They mirror what the SDK's `send.*` helpers
 * do (compute budget + ATA creation + the SDK instruction builder), but return an unsigned
 * Transaction so that (a) a browser wallet can sign it and (b) the exact same transaction
 * can be simulated for an authoritative quote.
 */

export type TradeSide = "YES" | "NO";
export type TradeAction = "BUY" | "SELL";

export function swapDirection(action: TradeAction, side: TradeSide): SwapDirection {
  if (action === "BUY") return side === "YES" ? "usdcToYes" : "usdcToNo";
  return side === "YES" ? "yesToUsdc" : "noToUsdc";
}

function ata(mint: PublicKey, owner: PublicKey, allowOffCurve = false): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, allowOffCurve);
}

function ensureAta(payer: PublicKey, owner: PublicKey, mint: PublicKey, allowOffCurve = false): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(payer, ata(mint, owner, allowOffCurve), owner, mint);
}

export interface MarketKeys {
  market: PublicKey;
  authority: PublicKey;
  collateralMint: PublicKey;
}

export interface TradeAccounts {
  userCollateral: PublicKey;
  userYes: PublicKey;
  userNo: PublicKey;
}

export function tradeAccounts(client: PmAmmClient, keys: MarketKeys, owner: PublicKey): TradeAccounts {
  return {
    userCollateral: ata(keys.collateralMint, owner),
    userYes: ata(client.yesMint(keys.market), owner),
    userNo: ata(client.noMint(keys.market), owner),
  };
}

async function finalize(connection: Connection, feePayer: PublicKey, ixs: TransactionInstruction[]): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(...ixs);
  return tx;
}

export async function buildSwapTx(
  client: PmAmmClient,
  p: { owner: PublicKey; keys: MarketKeys; direction: SwapDirection; amountIn: bigint; minOutput: bigint },
): Promise<Transaction> {
  const { owner, keys } = p;
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.HEAVY }),
    ensureAta(owner, owner, keys.collateralMint),
    ensureAta(owner, owner, client.yesMint(keys.market)),
    ensureAta(owner, owner, client.noMint(keys.market)),
    // Fee recipients must exist: protocol DAO and the market authority (creator fee).
    ensureAta(owner, PROTOCOL_DAO, keys.collateralMint, true),
  ];
  if (!keys.authority.equals(owner)) ixs.push(ensureAta(owner, keys.authority, keys.collateralMint, true));
  ixs.push(
    await client.ix.swap({
      signer: owner,
      market: keys.market,
      direction: p.direction,
      amountIn: p.amountIn,
      minOutput: p.minOutput,
      creatorAuthority: keys.authority,
    }),
  );
  return finalize(client.connection, owner, ixs);
}

export async function buildDepositLiquidityTx(
  client: PmAmmClient,
  p: { owner: PublicKey; keys: MarketKeys; amount: bigint },
): Promise<Transaction> {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.HEAVY }),
    ensureAta(p.owner, p.owner, p.keys.collateralMint),
    await client.ix.depositLiquidity({ signer: p.owner, market: p.keys.market, amount: p.amount }),
  ];
  return finalize(client.connection, p.owner, ixs);
}

export async function buildClaimWinningsTx(client: PmAmmClient, p: { owner: PublicKey; keys: MarketKeys }): Promise<Transaction> {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT }),
    ensureAta(p.owner, p.owner, p.keys.collateralMint),
    ensureAta(p.owner, p.owner, client.yesMint(p.keys.market)),
    ensureAta(p.owner, p.owner, client.noMint(p.keys.market)),
    await client.ix.claimWinnings({ signer: p.owner, market: p.keys.market }),
  ];
  return finalize(client.connection, p.owner, ixs);
}

export async function buildRedeemPairTx(
  client: PmAmmClient,
  p: { owner: PublicKey; keys: MarketKeys; amount: bigint },
): Promise<Transaction> {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT }),
    ensureAta(p.owner, p.owner, p.keys.collateralMint),
    await client.ix.redeemPair({ signer: p.owner, market: p.keys.market, amount: p.amount }),
  ];
  return finalize(client.connection, p.owner, ixs);
}

function tokenAmount(data: Buffer | null | undefined): bigint {
  if (!data || data.length < AccountLayout.span) return 0n;
  return AccountLayout.decode(data).amount;
}

export interface SimulatedDeltas {
  ok: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
  /** Balance changes for the owner's collateral / YES / NO accounts (micro-units, signed). */
  collateral: bigint;
  yes: bigint;
  no: bigint;
}

/**
 * Run the exact unsigned transaction through `simulateTransaction` and read the post-balances
 * of the user's token accounts. Quotes therefore come from the deployed program itself
 * (fees, rounding, accrual and all), not from off-chain math.
 */
export async function simulateBalanceDeltas(
  connection: Connection,
  tx: Transaction,
  accounts: TradeAccounts,
): Promise<SimulatedDeltas> {
  const addrs = [accounts.userCollateral, accounts.userYes, accounts.userNo];
  const pre = await connection.getMultipleAccountsInfo(addrs, "confirmed");
  const message = tx.compileMessage();
  const vtx = new VersionedTransaction(VersionedMessage.deserialize(message.serialize()));
  const sim = await connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: addrs.map((a) => a.toBase58()) },
  });
  const v = sim.value;
  const logs = v.logs ?? [];
  if (v.err) return { ok: false, error: JSON.stringify(v.err), logs, unitsConsumed: v.unitsConsumed ?? null, collateral: 0n, yes: 0n, no: 0n };
  const post = (v.accounts ?? []).map((a) => (a ? Buffer.from(a.data[0] ?? "", "base64") : null));
  const delta = (i: number) => tokenAmount(post[i]) - tokenAmount(pre[i]?.data);
  return { ok: true, error: null, logs, unitsConsumed: v.unitsConsumed ?? null, collateral: delta(0), yes: delta(1), no: delta(2) };
}

export interface TradeQuote {
  ok: boolean;
  error: string | null;
  action: TradeAction;
  side: TradeSide;
  amountIn: bigint;
  /** Exact output from simulation (shares for a buy, USDC for a sell). */
  amountOut: bigint;
  logs: string[];
}

/** Authoritative quote: simulate the real swap with minOutput = 0. */
export async function quoteTrade(
  client: PmAmmClient,
  p: { owner: PublicKey; keys: MarketKeys; action: TradeAction; side: TradeSide; amountIn: bigint },
): Promise<TradeQuote> {
  const direction = swapDirection(p.action, p.side);
  const tx = await buildSwapTx(client, { owner: p.owner, keys: p.keys, direction, amountIn: p.amountIn, minOutput: 0n });
  const d = await simulateBalanceDeltas(client.connection, tx, tradeAccounts(client, p.keys, p.owner));
  const amountOut = !d.ok ? 0n : p.action === "BUY" ? (p.side === "YES" ? d.yes : d.no) : d.collateral;
  return { ok: d.ok, error: d.error, action: p.action, side: p.side, amountIn: p.amountIn, amountOut, logs: d.logs };
}

/** Owner's YES/NO/collateral balances for a market (raw micro-units). */
export async function readHoldings(
  client: PmAmmClient,
  keys: MarketKeys,
  owner: PublicKey,
): Promise<{ collateral: bigint; yes: bigint; no: bigint }> {
  const a = tradeAccounts(client, keys, owner);
  const infos = await client.connection.getMultipleAccountsInfo([a.userCollateral, a.userYes, a.userNo], "confirmed");
  return { collateral: tokenAmount(infos[0]?.data), yes: tokenAmount(infos[1]?.data), no: tokenAmount(infos[2]?.data) };
}
