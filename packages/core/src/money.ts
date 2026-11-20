/** USDC and pm-AMM outcome tokens use 6 decimals. All DB amounts are bigint micro-units. */
export const USDC_DECIMALS = 6;
const SCALE = 1_000_000n;

/** Parse a human decimal string/number into micro-units without float rounding errors. */
export function toMicro(human: string | number): bigint {
  const s = typeof human === "number" ? human.toFixed(USDC_DECIMALS) : human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${human}`);
  const [int, frac = ""] = s.split(".");
  if (frac.length > USDC_DECIMALS && /[1-9]/.test(frac.slice(USDC_DECIMALS)))
    throw new Error(`amount has more than ${USDC_DECIMALS} decimals: ${human}`);
  return BigInt(int!) * SCALE + BigInt((frac + "000000").slice(0, USDC_DECIMALS));
}

export function fromMicro(micro: bigint): string {
  const neg = micro < 0n;
  const abs = neg ? -micro : micro;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

export function formatUsd(micro: bigint, maxFrac = 2): string {
  const n = Number(micro) / 1e6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, maxFrac) });
}

/** Apply slippage tolerance (bps) to an expected output, rounding down. */
export function minOutWithSlippage(expected: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 5000) throw new Error("slippage must be 0..5000 bps");
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function formatProbability(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const pct = p * 100;
  return `${pct < 1 || pct > 99 ? pct.toFixed(1) : Math.round(pct)}%`;
}
