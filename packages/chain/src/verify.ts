import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export type TxVerification =
  | { status: "PENDING" }
  | { status: "FAILED"; reason: string; slot?: number }
  | {
      status: "CONFIRMED";
      slot: number;
      blockTime: number | null;
      /** Net token balance changes of `owner`, keyed by mint (micro-units). */
      ownerDeltas: Record<string, bigint>;
    };

export interface ExpectedTx {
  programId: PublicKey;
  /** Must be the fee payer and a signer. */
  owner: PublicKey;
  /** Accounts that must appear in the transaction (e.g. the market PDA). */
  mustInclude: PublicKey[];
}

function ownerDeltas(tx: ParsedTransactionWithMeta, owner: string): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  const add = (mint: string, v: bigint) => (out[mint] = (out[mint] ?? 0n) + v);
  for (const b of tx.meta?.postTokenBalances ?? []) if (b.owner === owner) add(b.mint, BigInt(b.uiTokenAmount.amount));
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.owner === owner) add(b.mint, -BigInt(b.uiTokenAmount.amount));
  return out;
}

/**
 * Verify a user-submitted signature against what GoalFi expects. A Transaction row becomes
 * CONFIRMED only after this returns CONFIRMED.
 */
export async function verifyProgramTransaction(connection: Connection, signature: string, exp: ExpectedTx): Promise<TxVerification> {
  const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) {
    const st = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (st.value?.err) return { status: "FAILED", reason: JSON.stringify(st.value.err), slot: st.context.slot };
    return { status: "PENDING" };
  }
  if (tx.meta?.err) return { status: "FAILED", reason: JSON.stringify(tx.meta.err), slot: tx.slot };
  const keys = tx.transaction.message.accountKeys;
  const payer = keys[0];
  if (!payer || !payer.pubkey.equals(exp.owner) || !payer.signer)
    return { status: "FAILED", reason: "fee payer / signer does not match the user's linked wallet", slot: tx.slot };
  const invoked = tx.transaction.message.instructions.some((ix) => ix.programId.equals(exp.programId));
  if (!invoked) return { status: "FAILED", reason: "transaction does not invoke the pm-AMM program", slot: tx.slot };
  for (const must of exp.mustInclude)
    if (!keys.some((k) => k.pubkey.equals(must)))
      return { status: "FAILED", reason: `transaction does not touch ${must.toBase58()}`, slot: tx.slot };
  return { status: "CONFIRMED", slot: tx.slot, blockTime: tx.blockTime ?? null, ownerDeltas: ownerDeltas(tx, exp.owner.toBase58()) };
}

// ───────────── Wallet sign-in (Sign-In-With-Solana style) ─────────────

export function walletLinkMessage(p: { domain: string; wallet: string; nonce: string; issuedAt: string; username: string }): string {
  return [
    `${p.domain} wants you to link your Solana wallet to GoalFi.`,
    "",
    `Wallet: ${p.wallet}`,
    `Account: @${p.username}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    "",
    "Signing this message does not send a transaction or cost anything.",
  ].join("\n");
}

export function verifyWalletSignature(message: string, signatureBase58: string, walletBase58: string): boolean {
  try {
    const pk = new PublicKey(walletBase58).toBytes();
    const sig = bs58.decode(signatureBase58);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
  } catch {
    return false;
  }
}
