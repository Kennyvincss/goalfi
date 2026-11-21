import { capitalPhi, estimateSwapOutput, i80f48ToNumber, phi, poolValue, priceFromReserves } from "@pm-amm/sdk/math";

/** 2% protocol fee on the USDC leg of USDC↔outcome swaps (SDK `SWAP_FEE_BPS`). */
export const SWAP_FEE_BPS = 200;

/** Fixed-point (I80F48) u128 → float, via the SDK helper. */
export function fx(raw: { toString(): string } | bigint): number {
  return i80f48ToNumber(raw);
}

/**
 * Effective liquidity implied by the pool reserves.
 *
 * The SDK's curve (math.ts `findXFromY` / `findYFromX`), with x = reserveYes and y = reserveNo:
 *   x = L·(uΦ(u) + φ(u) − u),   y = L·(uΦ(u) + φ(u)),   u = (y − x)/L,   P_yes = Φ(u).
 * With d = y − x:  y = d·Φ(d/L) + L·φ(d/L)  and  ∂y/∂L = φ(d/L) > 0, so L is the unique
 * root of a monotone function. Solving it from the on-chain reserves recovers the L_eff the
 * program last accrued at. It needs no assumption about the time units of L₀·√(T−t).
 */
export function impliedLEff(reserveYes: number, reserveNo: number): number {
  const x = reserveYes;
  const y = reserveNo;
  if (!(x > 0) || !(y > 0)) return 0;
  const d = y - x;
  const g = (L: number) => d * capitalPhi(d / L) + L * phi(d / L) - y;
  let lo = 1e-12;
  let hi = Math.max(x, y) * 4 + 1;
  while (g(hi) < 0) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < 0) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-10 * hi) break;
  }
  return (lo + hi) / 2;
}

export interface PoolState {
  /** Reserves in micro-units (6 dp) as floats. */
  reserveYes: number;
  reserveNo: number;
  lEff: number;
  /** YES probability in (0,1); NaN if the pool has no liquidity. */
  yesPrice: number;
  /** Pool value V(P) = L·φ(Φ⁻¹(P)), micro-units. */
  poolValue: number;
}

export function poolState(reserveYes: number, reserveNo: number): PoolState {
  const lEff = impliedLEff(reserveYes, reserveNo);
  if (lEff <= 0) return { reserveYes, reserveNo, lEff: 0, yesPrice: NaN, poolValue: 0 };
  const yesPrice = priceFromReserves(reserveYes, reserveNo, lEff);
  return { reserveYes, reserveNo, lEff, yesPrice, poolValue: poolValue(yesPrice, lEff) };
}

export function poolStateFromRaw(reserveYesRaw: { toString(): string }, reserveNoRaw: { toString(): string }): PoolState {
  return poolState(fx(reserveYesRaw), fx(reserveNoRaw));
}

export interface BuyEstimate {
  /** Outcome tokens out, micro-units (approximate, float math). */
  sharesOut: number;
  /** Average USDC paid per share, fee included. */
  avgPrice: number;
  priceAfter: number;
  priceImpact: number;
  feeMicro: number;
}

/**
 * Instant, approximate buy estimate (display only). Applies the 2% fee that
 * `estimateSwapOutput` ignores. Execution uses the simulated quote (`trade.ts`).
 */
export function estimateBuy(pool: PoolState, side: "yes" | "no", usdcInMicro: number): BuyEstimate | null {
  if (pool.lEff <= 0 || usdcInMicro <= 0) return null;
  const fee = (usdcInMicro * SWAP_FEE_BPS) / 10_000;
  const net = usdcInMicro - fee;
  const r = estimateSwapOutput(pool.reserveYes, pool.reserveNo, pool.lEff, net, side);
  if (!(r.output > 0)) return null;
  return { sharesOut: r.output, avgPrice: usdcInMicro / r.output, priceAfter: r.priceAfter, priceImpact: r.priceImpact, feeMicro: fee };
}
