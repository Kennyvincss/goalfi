import { toMicro } from "./money";

/** Slippage presets in basis points. */
export const SLIPPAGE_PRESETS_BPS = [50, 100, 200, 500] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Parse a user-typed amount into micro-units (6 dp). Returns null for empty/invalid/zero. */
export function parseAmount(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!s) return null;
  try {
    const v = toMicro(s);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export type Valuation =
  /** Before resolution: shares × current YES/NO price. An estimate, not a guaranteed exit price. */
  | { kind: "mark"; valueMicro: bigint }
  /** After resolution: winning shares redeem 1:1 for collateral. Exact. */
  | { kind: "settled"; valueMicro: bigint; claimableMicro: bigint }
  | { kind: "unknown" };

/**
 * Value of an outcome-token position. Outcome tokens have 6 decimals and a winning token
 * redeems for exactly 1 unit of collateral (`claim_winnings`), so shares in micro-units equal
 * payout in micro-units.
 */
export function valuePosition(p: {
  yes: bigint;
  no: bigint;
  yesPrice: number | null;
  resolved: boolean;
  winner: "YES" | "NO" | null;
}): Valuation {
  if (p.resolved) {
    if (!p.winner) return { kind: "unknown" };
    const win = p.winner === "YES" ? p.yes : p.no;
    return { kind: "settled", valueMicro: win, claimableMicro: win };
  }
  if (p.yesPrice === null || !Number.isFinite(p.yesPrice)) return { kind: "unknown" };
  const v = Number(p.yes) * p.yesPrice + Number(p.no) * (1 - p.yesPrice);
  return { kind: "mark", valueMicro: BigInt(Math.round(v)) };
}

/** Full YES+NO pairs that can be redeemed for collateral at any time (`redeem_pair`). */
export function redeemablePairs(yes: bigint, no: bigint): bigint {
  return yes < no ? yes : no;
}

/** Effective price paid/received per share (collateral per outcome token), from exact amounts. */
export function effectivePrice(collateralMicro: bigint, sharesMicro: bigint): number | null {
  if (sharesMicro <= 0n) return null;
  return Number(collateralMicro) / Number(sharesMicro);
}
