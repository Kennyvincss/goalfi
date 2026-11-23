import { describe, expect, it } from "vitest";
import { capitalPhi, phi } from "@pm-amm/sdk/math";
import { estimateBuy, impliedLEff, poolState } from "./curve";

/** Reserves on the SDK curve for a given L and YES price. */
function reservesAt(L: number, pYes: number): { yes: number; no: number } {
  // P = Φ(u) ⇒ u = Φ⁻¹(P); invert numerically with bisection on Φ.
  let lo = -10, hi = 10;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (capitalPhi(m) < pYes) lo = m;
    else hi = m;
  }
  const u = (lo + hi) / 2;
  return { yes: L * (u * capitalPhi(u) + phi(u) - u), no: L * (u * capitalPhi(u) + phi(u)) };
}

describe("impliedLEff", () => {
  for (const p of [0.5, 0.2, 0.68, 0.95]) {
    it(`recovers L at P=${p}`, () => {
      const L = 1_234_567;
      const r = reservesAt(L, p);
      expect(impliedLEff(r.yes, r.no) / L).toBeCloseTo(1, 4);
      const s = poolState(r.yes, r.no);
      expect(s.yesPrice).toBeCloseTo(p, 3);
    });
  }
  it("returns 0 for an empty pool", () => {
    expect(impliedLEff(0, 0)).toBe(0);
    expect(Number.isNaN(poolState(0, 0).yesPrice)).toBe(true);
  });
});

describe("estimateBuy", () => {
  it("applies the 2% fee and moves price toward the bought side", () => {
    const r = reservesAt(50_000_000, 0.5);
    const s = poolState(r.yes, r.no);
    const e = estimateBuy(s, "yes", 10_000_000)!;
    expect(e.feeMicro).toBe(200_000);
    expect(e.priceAfter).toBeGreaterThan(0.5);
    expect(e.avgPrice).toBeGreaterThan(0.5); // paying above the pre-trade price + fee
    const n = estimateBuy(s, "no", 10_000_000)!;
    expect(n.priceAfter).toBeLessThan(0.5); // YES price after buying NO
  });
});
