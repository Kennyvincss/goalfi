import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnchorProvider, type Wallet } from "@anchor-lang/core";
import bs58 from "bs58";
import { CU, PROTOCOL_DAO, PmAmmClient, mapAnchorError, randomU48 } from "@pm-amm/sdk";
import type { ChainConfig } from "./config";
import { toMarketView, type MarketView } from "./market";

/**
 * SERVER ONLY. Operations signed by GoalFi's platform market-authority key:
 * market creation and resolution. Business rules (who may resolve, when) are NOT here.
 * The app layer must run `@goalfi/core` evaluateResolution() before calling resolve.
 */

export function loadAuthorityKeypair(secretBase58: string | undefined): Keypair {
  if (!secretBase58) throw new Error("GOALFI_MARKET_AUTHORITY_SECRET is not set");
  const bytes = bs58.decode(secretBase58.trim());
  if (bytes.length !== 64) throw new Error("GOALFI_MARKET_AUTHORITY_SECRET must be a base58 64-byte secret key");
  return Keypair.fromSecretKey(bytes);
}

export class KeypairWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

export interface AuthorityContext {
  cfg: ChainConfig;
  connection: Connection;
  keypair: Keypair;
  client: PmAmmClient;
}

export function authorityContext(cfg: ChainConfig, connection: Connection, keypair: Keypair): AuthorityContext {
  const provider = new AnchorProvider(connection, new KeypairWallet(keypair), { commitment: cfg.commitment });
  return { cfg, connection, keypair, client: PmAmmClient.fromProvider(provider, cfg.programId, cfg.collateralMint) };
}

export interface SentTx {
  signature: string;
  slot: number;
}

export class ChainTxError extends Error {
  constructor(
    message: string,
    readonly signature: string | null,
    readonly programError: { code: number; name: string; msg?: string } | null,
  ) {
    super(message);
  }
}

/**
 * Sign, persist-hook, send and confirm. `onSigned` runs BEFORE broadcast so the caller can
 * record the signature (intent row). After a crash, the reconciler can look the tx up.
 */
export async function signSendConfirm(
  connection: Connection,
  ixs: TransactionInstruction[],
  signer: Keypair,
  onSigned?: (signature: string) => Promise<void>,
): Promise<SentTx> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(signer);
  const signature = bs58.encode(tx.signature!);
  if (onSigned) await onSigned(signature);
  try {
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (err) {
    throw new ChainTxError(`send failed: ${(err as Error).message}`, signature, mapAnchorError(err));
  }
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new ChainTxError(`transaction failed: ${JSON.stringify(res.value.err)}`, signature, mapAnchorError(res.value.err));
  return { signature, slot: res.context.slot };
}

/** A fresh u48 market id (same generator the SDK uses: unpredictable to avoid id front-running). */
export function newOnchainId(): bigint {
  return BigInt(randomU48());
}

export interface CreateMarketParams {
  onchainId: bigint;
  /** Absolute close time = challenge end date. */
  endTs: Date;
  name: string;
  /** 0 = 50/50, else 100..9900. Applies at first deposit. */
  initialPriceBps: number;
}

/**
 * Create a binary market owned by the platform authority. Also ensures the authority's and the
 * protocol DAO's collateral ATAs exist (swap fees are paid into them). Safe to retry: if the
 * PDA already exists the existing market is returned.
 */
export async function createBinaryMarket(
  ctx: AuthorityContext,
  p: CreateMarketParams,
  onSigned?: (signature: string) => Promise<void>,
): Promise<{ market: PublicKey; signature: string | null; view: MarketView }> {
  const market = ctx.client.marketPda(p.onchainId);
  const existing = await ctx.client.fetchMarket(market);
  if (existing) return { market, signature: null, view: toMarketView(market, existing) };

  const authority = ctx.keypair.publicKey;
  const mint = ctx.cfg.collateralMint;
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.HEAVY }),
    createAssociatedTokenAccountIdempotentInstruction(authority, getAssociatedTokenAddressSync(mint, authority, true), authority, mint),
    createAssociatedTokenAccountIdempotentInstruction(authority, getAssociatedTokenAddressSync(mint, PROTOCOL_DAO, true), PROTOCOL_DAO, mint),
    await ctx.client.ix.initializeMarket({
      authority,
      marketId: p.onchainId,
      endTs: Math.floor(p.endTs.getTime() / 1000),
      name: p.name,
      initialPriceBps: p.initialPriceBps,
    }),
  ];
  const sent = await signSendConfirm(ctx.connection, ixs, ctx.keypair, onSigned);
  const acc = await ctx.client.fetchMarket(market);
  if (!acc) throw new ChainTxError("market account missing after confirmed creation", sent.signature, null);
  return { market, signature: sent.signature, view: toMarketView(market, acc) };
}

/**
 * Resolve a binary market. Idempotent: returns the existing state if already resolved.
 * Refuses before end_ts (the program would reject with MarketNotExpired anyway).
 */
export async function resolveBinaryMarket(
  ctx: AuthorityContext,
  p: { market: PublicKey; side: "YES" | "NO" },
  onSigned?: (signature: string) => Promise<void>,
): Promise<{ signature: string | null; view: MarketView; alreadyResolved: boolean }> {
  const acc = await ctx.client.fetchMarket(p.market);
  if (!acc) throw new Error("market not found on-chain");
  if (!acc.authority.equals(ctx.keypair.publicKey)) throw new Error("platform key is not this market's authority");
  if (acc.resolved) return { signature: null, view: toMarketView(p.market, acc), alreadyResolved: true };
  if (Date.now() / 1000 < Number(acc.endTs.toString())) throw new Error("market has not expired yet");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.DEFAULT }),
    await ctx.client.ix.resolveMarket({ signer: ctx.keypair.publicKey, market: p.market, side: p.side === "YES" ? "yes" : "no" }),
  ];
  const sent = await signSendConfirm(ctx.connection, ixs, ctx.keypair, onSigned);
  const after = await ctx.client.fetchMarket(p.market);
  if (!after?.resolved) throw new ChainTxError("market not resolved after confirmed tx", sent.signature, null);
  return { signature: sent.signature, view: toMarketView(p.market, after), alreadyResolved: false };
}

/** Multi-outcome: author-side group with equal seeds (SDK flow, multiple txs). */
export async function createGroupMarket(
  ctx: AuthorityContext,
  p: { name: string; legNames: string[]; endTs: Date; budgetPerLegUsdc: number },
  onProgress?: (label: string, step: number) => void,
) {
  const durationSecs = Math.floor((p.endTs.getTime() - Date.now()) / 1000);
  return ctx.client.flows.createGroup({ name: p.name, legNames: p.legNames, durationSecs, budgetPerLegUsdc: p.budgetPerLegUsdc }, onProgress);
}

export async function resolveGroupMarket(
  ctx: AuthorityContext,
  p: { group: PublicKey; legMarkets: PublicKey[]; winningLeg: number | null },
): Promise<void> {
  await ctx.client.flows.resolveGroup({ group: p.group, legMarkets: p.legMarkets, winningLeg: p.winningLeg });
}
