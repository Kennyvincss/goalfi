import { PublicKey, VersionedMessage, VersionedTransaction, type Connection, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { mapAnchorError } from "@pm-amm/sdk";

/** Minimum SOL to cover fees plus possible token-account rent (~0.002 SOL each). */
export const MIN_SOL_LAMPORTS = 10_000_000; // 0.01 SOL

const FRIENDLY_PROGRAM_ERRORS: Record<string, string> = {
  SlippageExceeded: "The price moved beyond your slippage tolerance. Try again or allow more slippage.",
  InsufficientOutput: "The price moved beyond your slippage tolerance. Try again or allow more slippage.",
  MarketExpired: "Trading for this market has closed.",
  MarketAlreadyResolved: "This market is already resolved.",
  MarketNotResolved: "This market hasn't been resolved yet.",
  InsufficientBalance: "Your wallet doesn't hold enough of the tokens needed for this.",
  InsufficientLiquidity: "Not enough liquidity or balance for this trade.",
  InvalidBudget: "That amount isn't allowed. Try a larger amount.",
};

/**
 * Turn a failed simulation/transaction (error + program logs) into one plain sentence.
 * Pure: safe to unit-test with recorded logs.
 */
export function explainFailure(err: unknown, logs: string[] = [], symbol = "USDC"): string {
  const text = `${logs.join("\n")}\n${typeof err === "string" ? err : JSON.stringify(err) ?? ""}`;
  const mapped = mapAnchorError({ logs, message: text });
  if (mapped) return FRIENDLY_PROGRAM_ERRORS[mapped.name] ?? mapped.msg ?? mapped.name;
  if (/insufficient funds/i.test(text)) return `Not enough ${symbol} in your wallet for this amount.`;
  if (/no record of a prior credit|AccountNotFound|insufficient lamports/i.test(text))
    return "Your wallet needs a little devnet SOL for network fees. Get some free at faucet.solana.com.";
  if (/AccountNotInitialized|could not find account|InvalidAccountData/i.test(text))
    return `Your wallet doesn't have ${symbol} yet. Get test ${symbol} first.`;
  if (/BlockhashNotFound/i.test(text)) return "The network was busy. Please try again.";
  const last = [...logs].reverse().find((l) => /error|failed/i.test(l));
  return last ? `The transaction would fail: ${last.replace(/^Program log: /, "").slice(0, 160)}` : "The transaction would fail on-chain.";
}

export interface PreflightOptions {
  /** Collateral the transaction will spend (micro-units), checked against the wallet's balance. */
  spend?: { mint: PublicKey; amountMicro: bigint; symbol: string };
  symbol?: string;
}

/**
 * Check SOL and token balances and simulate the exact transaction BEFORE asking the wallet to
 * sign, so users get a specific reason instead of a wallet's generic "Unexpected error".
 * Returns null when everything looks fine, otherwise a plain-language problem.
 */
export async function preflightTransaction(connection: Connection, owner: PublicKey, tx: Transaction, opts: PreflightOptions = {}): Promise<string | null> {
  const symbol = opts.spend?.symbol ?? opts.symbol ?? "USDC";
  const lamports = await connection.getBalance(owner, "confirmed");
  if (lamports < MIN_SOL_LAMPORTS)
    return `Your wallet has ${(lamports / 1e9).toFixed(4)} SOL. It needs a little devnet SOL (0.01+) for network fees. Get some free at faucet.solana.com.`;
  if (opts.spend) {
    const ata = getAssociatedTokenAddressSync(opts.spend.mint, owner);
    const info = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
    const have = info ? BigInt(info.value.amount) : 0n;
    if (have < opts.spend.amountMicro)
      return `Your wallet has ${(Number(have) / 1e6).toLocaleString("en-US")} ${symbol}, but this needs ${(Number(opts.spend.amountMicro) / 1e6).toLocaleString("en-US")} ${symbol}. Get test ${symbol} first.`;
  }
  const vtx = new VersionedTransaction(VersionedMessage.deserialize(tx.compileMessage().serialize()));
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) return explainFailure(sim.value.err, sim.value.logs ?? [], symbol);
  return null;
}
