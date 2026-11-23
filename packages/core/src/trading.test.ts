import { describe, expect, it } from "vitest";
import { effectivePrice, parseAmount, redeemablePairs, valuePosition } from "./trading";

describe("trading helpers", () => {
  it("parses amounts safely", () => {
    expect(parseAmount("10")).toBe(10_000_000n);
    expect(parseAmount("1,000.5")).toBe(1_000_500_000n);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("1.0000001")).toBeNull();
  });
  it("marks open positions to the current price", () => {
    expect(valuePosition({ yes: 10_000_000n, no: 0n, yesPrice: 0.68, resolved: false, winner: null })).toEqual({ kind: "mark", valueMicro: 6_800_000n });
    expect(valuePosition({ yes: 0n, no: 10_000_000n, yesPrice: 0.68, resolved: false, winner: null })).toEqual({ kind: "mark", valueMicro: 3_200_000n });
    expect(valuePosition({ yes: 1n, no: 0n, yesPrice: NaN, resolved: false, winner: null }).kind).toBe("unknown");
  });
  it("settles resolved positions at 1:1 for the winner only", () => {
    expect(valuePosition({ yes: 5_000_000n, no: 3_000_000n, yesPrice: null, resolved: true, winner: "NO" })).toEqual({ kind: "settled", valueMicro: 3_000_000n, claimableMicro: 3_000_000n });
    expect(valuePosition({ yes: 5n, no: 0n, yesPrice: null, resolved: true, winner: null }).kind).toBe("unknown");
  });
  it("computes pairs and effective price", () => {
    expect(redeemablePairs(7n, 3n)).toBe(3n);
    expect(effectivePrice(10_000_000n, 18_500_000n)).toBeCloseTo(0.5405, 3);
    expect(effectivePrice(1n, 0n)).toBeNull();
  });
});
