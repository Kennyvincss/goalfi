import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PROTOCOL_DAO } from "@pm-amm/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { chainConfig, PM_AMM_DEPLOYMENTS } from "./config";
import { decodeWinningSide, readOnlyClient } from "./market";
import { swapDirection } from "./trade";
import { loadAuthorityKeypair, newOnchainId } from "./authority";
import { verifyWalletSignature, walletLinkMessage } from "./verify";

describe("config", () => {
  it("binds devnet to mUSDC", () => {
    const c = chainConfig("devnet", "https://api.devnet.solana.com");
    expect(c.collateralMint.toBase58()).toBe("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
    expect(c.programId.toBase58()).toBe("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
    expect(Object.isFrozen(c)).toBe(true);
  });
  it("blocks mainnet without explicit opt-in", () => {
    expect(() => chainConfig("mainnet-beta", "https://api.mainnet-beta.solana.com")).toThrow(/disabled/);
  });
  it("refuses mixed cluster/RPC", () => {
    expect(() => chainConfig("devnet", "https://api.mainnet-beta.solana.com")).toThrow();
    expect(() => chainConfig("mainnet-beta", "https://api.devnet.solana.com", { mainnetOptIn: "I_UNDERSTAND_THE_RISKS" })).toThrow();
  });
  it("devnet and mainnet collateral differ", () => {
    expect(PM_AMM_DEPLOYMENTS.devnet.collateralMint).not.toBe(PM_AMM_DEPLOYMENTS["mainnet-beta"].collateralMint);
  });
});

describe("SDK instruction building (offline)", () => {
  const cfg = chainConfig("devnet", "https://api.devnet.solana.com");
  const client = readOnlyClient(cfg, new Connection("http://127.0.0.1:9"));
  const user = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const market = client.marketPda(123456789n);

  it("derives market PDAs deterministically from the id", () => {
    expect(client.marketPda(123456789n).equals(market)).toBe(true);
    expect(client.marketPda(1n).equals(market)).toBe(false);
  });

  it("builds a swap ix that targets the program, market and DAO fee account", async () => {
    const ix = await client.ix.swap({
      signer: user, market, direction: swapDirection("BUY", "YES"), amountIn: 10_000_000n, minOutput: 1n, creatorAuthority: authority,
    });
    expect(ix.programId.equals(cfg.programId)).toBe(true);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(market.toBase58());
    expect(keys).toContain(getAssociatedTokenAddressSync(cfg.collateralMint, PROTOCOL_DAO, true).toBase58());
    expect(keys).toContain(getAssociatedTokenAddressSync(cfg.collateralMint, authority, true).toBase58());
    expect(ix.keys.find((k) => k.pubkey.equals(user))?.isSigner).toBe(true);
  });

  it("builds initialize + resolve ixs signed by the authority", async () => {
    const init = await client.ix.initializeMarket({ authority, marketId: 123456789n, endTs: 2_000_000_000, name: "Test", initialPriceBps: 6800 });
    expect(init.keys.find((k) => k.pubkey.equals(authority))?.isSigner).toBe(true);
    expect(init.keys.some((k) => k.pubkey.equals(market))).toBe(true);
    const res = await client.ix.resolveMarket({ signer: authority, market, side: "yes" });
    expect(res.keys.map((k) => k.pubkey.toBase58())).toEqual([authority.toBase58(), market.toBase58()]);
  });

  it("maps trade directions", () => {
    expect(swapDirection("BUY", "NO")).toBe("usdcToNo");
    expect(swapDirection("SELL", "YES")).toBe("yesToUsdc");
  });

  it("generates u48 ids", () => {
    const id = newOnchainId();
    expect(id > 0n && id < 2n ** 48n).toBe(true);
  });
});

describe("winning side decoding", () => {
  it("is null until resolved", () => expect(decodeWinningSide(false, 1)).toBeNull());
  it("maps 1/2", () => {
    expect(decodeWinningSide(true, 1)).toBe("YES");
    expect(decodeWinningSide(true, 2)).toBe("NO");
    expect(decodeWinningSide(true, 0)).toBe("UNKNOWN");
  });
});

describe("authority key loading", () => {
  it("round-trips a base58 secret", () => {
    const kp = Keypair.generate();
    expect(loadAuthorityKeypair(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
  });
  it("rejects missing or malformed keys", () => {
    expect(() => loadAuthorityKeypair(undefined)).toThrow();
    expect(() => loadAuthorityKeypair("abc")).toThrow();
  });
});

describe("wallet signature", () => {
  const kp = nacl.sign.keyPair();
  const wallet = new PublicKey(kp.publicKey).toBase58();
  const msg = walletLinkMessage({ domain: "goalfi.app", wallet, nonce: "n1", issuedAt: "2026-01-01T00:00:00Z", username: "alice" });
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
  it("verifies a valid signature", () => expect(verifyWalletSignature(msg, sig, wallet)).toBe(true));
  it("rejects a tampered message", () => expect(verifyWalletSignature(msg.replace("n1", "n2"), sig, wallet)).toBe(false));
  it("rejects another wallet", () =>
    expect(verifyWalletSignature(msg, sig, Keypair.generate().publicKey.toBase58())).toBe(false));
  it("rejects garbage", () => expect(verifyWalletSignature(msg, "xyz", wallet)).toBe(false));
});
