import type { MarketGateway, OnchainMarketState, UserTxResult } from "../gateway";

/**
 * TEST-ONLY in-memory MarketGateway. Mirrors the pm-AMM program's observable rules that services
 * rely on (idempotent create by id, resolve only after end_ts and only once). Never used in production.
 */
export class FakeGateway implements MarketGateway {
  cluster = "DEVNET" as const;
  programId = "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y";
  collateralMint = "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ";
  collateralSymbol = "mUSDC";
  authority = "AuthorityPubkey1111111111111111111111111111";
  markets = new Map<string, OnchainMarketState>();
  txs = new Map<string, UserTxResult>();
  failNextCreate = false;
  private seq = 1n;
  constructor(private readonly clock: () => Date) {}
  newOnchainId() { return this.seq++; }
  marketAddressFor(id: bigint) { return `Market${id.toString().padStart(38, "1")}`; }
  async createBinaryMarket(p: { onchainId: bigint; endTs: Date; name: string; initialPriceBps: number }, onSigned: (s: string) => Promise<void>) {
    const address = this.marketAddressFor(p.onchainId);
    if (this.markets.has(address)) return { address, signature: null };
    if (this.failNextCreate) { this.failNextCreate = false; throw new Error("blockhash not found"); }
    const sig = `CreateSig${p.onchainId}`.padEnd(88, "1");
    await onSigned(sig);
    this.markets.set(address, { address, resolved: false, winningSide: null, endTs: Math.floor(p.endTs.getTime() / 1000), hasLiquidity: false, yesPrice: NaN, reserveYes: 0, reserveNo: 0, lEff: 0, poolValue: 0 });
    return { address, signature: sig };
  }
  async resolveBinaryMarket(p: { address: string; side: "YES" | "NO" }, onSigned: (s: string) => Promise<void>) {
    const m = this.markets.get(p.address);
    if (!m) throw new Error("market not found on-chain");
    if (m.resolved) return { signature: null };
    if (this.clock().getTime() / 1000 < m.endTs) throw new Error("MarketNotExpired");
    const sig = `ResolveSig${p.address.slice(6, 20)}`.padEnd(88, "1");
    await onSigned(sig);
    m.resolved = true;
    m.winningSide = p.side;
    return { signature: sig };
  }
  async fetchMarket(address: string) { return this.markets.get(address) ?? null; }
  /** Tests register the on-chain outcome of a user transaction before submitting it. */
  setTx(signature: string, r: UserTxResult) { this.txs.set(signature, r); }
  async verifyUserTx(signature: string): Promise<UserTxResult> {
    return this.txs.get(signature) ?? { status: "PENDING" };
  }
  setPool(address: string, yesPrice: number, poolValue: number) {
    const m = this.markets.get(address)!;
    Object.assign(m, { hasLiquidity: true, yesPrice, poolValue, reserveYes: 1, reserveNo: 1, lEff: 1 });
  }
  explorerTxUrl(sig: string) { return `https://solscan.io/tx/${sig}?cluster=devnet`; }
}
