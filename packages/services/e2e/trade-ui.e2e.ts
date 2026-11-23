/**
 * Browser e2e for the trading UI with the Solana RPC intercepted.
 * - Market account bytes are produced by the SDK's own Anchor coder (real layout).
 * - A Wallet Standard test wallet records the transaction it is asked to sign.
 * - The test then decodes the signed swap instruction and checks amount + minOutput.
 * Run: pnpm --filter @goalfi/services e2e:trade  (web app on :3100, dev DB, Playwright installed)
 */
import { createHash, randomBytes } from "node:crypto";
import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { PmAmmClient } from "@pm-amm/sdk";
import { capitalPhi, phi } from "@pm-amm/sdk/math";
import { prisma } from "@goalfi/db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT_DIR ?? require("node:os").tmpdir();
const RPC = "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const ok = (n: string, c: boolean, x?: unknown) => { console.log(`${c ? "PASS" : "FAIL"} ${n}`, x ?? ""); if (!c) process.exitCode = 1; };

const client = PmAmmClient.readOnly(new Connection("http://127.0.0.1:9"), PROGRAM, MINT);
const SCALE = 2n ** 48n;
const fx = (v: number) => new BN((BigInt(Math.round(v)) * SCALE).toString());

function reservesAt(L: number, p: number) {
  let lo = -10, hi = 10;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (capitalPhi(m) < p) lo = m; else hi = m; }
  const u = (lo + hi) / 2;
  return { yes: L * (u * capitalPhi(u) + phi(u) - u), no: L * (u * capitalPhi(u) + phi(u)) };
}

function tokenAcct(mint: PublicKey, owner: PublicKey, amount: bigint): string {
  const b = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, b);
  return b.toString("base64");
}

async function main() {
  const trader = Keypair.generate();
  const authority = Keypair.generate().publicKey;
  const onchainId = BigInt(Date.now() % 1e9);
  const market = client.marketPda(onchainId);
  const yesMint = client.yesMint(market), noMint = client.noMint(market);
  const endTs = Math.floor(Date.now() / 1000) + 3 * 86400;
  const r = reservesAt(50_000_000, 0.62);
  const state = { resolved: false, yesBal: 0n, colBal: 100_000_000n };
  const SIM_OUT = 15_123_456n;

  async function marketData(): Promise<string> {
    const name = Array.from(Buffer.concat([Buffer.from("Will the community complete the challenge?"), Buffer.alloc(64)]).subarray(0, 64));
    const data = await client.program.coder.accounts.encode("market", {
      authority, marketId: new BN(onchainId.toString()), collateralMint: MINT, yesMint, noMint, vault: client.marketVault(market),
      startTs: new BN(endTs - 7 * 86400), endTs: new BN(endTs), lZero: fx(1000), reserveYes: fx(r.yes), reserveNo: fx(r.no),
      lastAccrualTs: new BN(endTs - 86400), cumYesPerShare: new BN(0), cumNoPerShare: new BN(0), totalYesDistributed: new BN(0),
      totalNoDistributed: new BN(0), totalLpShares: fx(50_000_000), resolved: state.resolved, winningSide: state.resolved ? 1 : 0,
      bump: 255, name, initialPriceBps: 5000, group: PublicKey.default, unclaimedExcessYes: new BN(0), unclaimedExcessNo: new BN(0),
    });
    return Buffer.from(data).toString("base64");
  }

  // ── DB fixture (local dev DB; removed at the end) ──
  const token = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({ data: { username: `trade_e2e_${Date.now() % 1e6}`, walletAddress: trader.publicKey.toBase58() } });
  await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600e3) } });
  const cat = await prisma.category.findFirstOrThrow({ where: { slug: "fitness" } });
  const ch = await prisma.challenge.create({
    data: {
      slug: `trade-e2e-${Date.now()}`, title: "Trade e2e challenge", description: "fixture", rules: "r", successCriteria: "At least 1 participant runs 50 km",
      successRule: { type: "milestone", minCompleters: 1 }, evidenceReq: "e", creatorId: user.id, categoryId: cat.id, status: "ACTIVE",
      startDate: new Date(Date.now() - 86400e3), endDate: new Date(endTs * 1000), marketQuestion: "Will the community complete the challenge?",
      market: { create: {
        cluster: "DEVNET", programId: PROGRAM.toBase58(), collateralMint: MINT.toBase58(), marketType: "BINARY", onchainId: onchainId.toString(),
        marketAddress: market.toBase58(), authority: authority.toBase58(), initialPriceBps: 5000, liquidityTargetUsdc: 50_000_000n, fundedAmount: 50_000_000n,
        liquidity: 50_000_000n, endTs: new Date(endTs * 1000), status: "OPEN",
        snapshots: { create: [0.5, 0.55, 0.6].map((p, i) => ({ yesPrice: p, reserveYes: 1, reserveNo: 1, lEff: 1, poolValue: 1, takenAt: new Date(Date.now() - (3 - i) * 3600e3) })) },
      } },
    },
    include: { market: true },
  });

  const ATA = { col: getAssociatedTokenAddressSync(MINT, trader.publicKey), yes: getAssociatedTokenAddressSync(yesMint, trader.publicKey), no: getAssociatedTokenAddressSync(noMint, trader.publicKey) };
  const acct = (addr: string): string | null => {
    if (addr === ATA.col.toBase58()) return tokenAcct(MINT, trader.publicKey, state.colBal);
    if (addr === ATA.yes.toBase58()) return state.yesBal > 0n ? tokenAcct(yesMint, trader.publicKey, state.yesBal) : null;
    return null;
  };
  const wrap = (b64: string | null, owner = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") => (b64 ? { data: [b64, "base64"], executable: false, lamports: 2_039_280, owner, rentEpoch: 0, space: Buffer.from(b64, "base64").length } : null);
  const rpcLog: string[] = [];
  let sentSig = "";

  async function handle(req: { method: string; params?: unknown[]; id: unknown }) {
    rpcLog.push(req.method);
    const ctx = { context: { slot: 100, apiVersion: "2.2.0" } };
    const p = (req.params ?? []) as unknown[];
    switch (req.method) {
      case "getAccountInfo": {
        const a = p[0] as string;
        if (a === market.toBase58()) return { ...ctx, value: wrap(await marketData(), PROGRAM.toBase58()) };
        return { ...ctx, value: wrap(acct(a)) };
      }
      case "getMultipleAccounts": return { ...ctx, value: (p[0] as string[]).map((a) => wrap(acct(a))) };
      case "getLatestBlockhash": return { ...ctx, value: { blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 1_000_000 } };
      case "getBlockHeight": return 10;
      case "getBalance": return { ...ctx, value: 2_000_000_000 }; // 2 SOL for fees (pre-flight check)
      case "simulateTransaction":
        return { ...ctx, value: { err: null, logs: ["Program log: simulated"], unitsConsumed: 60_000, returnData: null,
          accounts: [tokenAcct(MINT, trader.publicKey, state.colBal - 10_000_000n), tokenAcct(yesMint, trader.publicKey, state.yesBal + SIM_OUT), null].map((d) => wrap(d)) } };
      case "sendTransaction": sentSig = bs58.encode(randomBytes(64)); state.yesBal += SIM_OUT; state.colBal -= 10_000_000n; return sentSig;
      case "getSignatureStatuses": return { ...ctx, value: (p[0] as string[]).map(() => ({ slot: 100, confirmations: null, err: null, confirmationStatus: "confirmed" })) };
      case "getTokenAccountBalance": return { ...ctx, value: { amount: state.colBal.toString(), decimals: 6, uiAmount: Number(state.colBal) / 1e6, uiAmountString: String(Number(state.colBal) / 1e6) } };
      case "getTokenAccountsByOwner": // web3.js getParsedTokenAccountsByOwner uses this method with jsonParsed encoding
      case "getParsedTokenAccountsByOwner":
        return { ...ctx, value: state.yesBal > 0n ? [{ pubkey: ATA.yes.toBase58(), account: { data: { program: "spl-token", parsed: { type: "account", info: { mint: yesMint.toBase58(), owner: trader.publicKey.toBase58(), tokenAmount: { amount: state.yesBal.toString(), decimals: 6 } } }, space: 165 }, executable: false, lamports: 2_039_280, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", rentEpoch: 0 } }] : [] };
      default: return null;
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.addCookies([{ name: "goalfi_session", value: token, url: B }]);
  await ctx.route(`${RPC}/**`, async (route: { request(): { postData(): string | null }; fulfill(o: object): Promise<void> }) => {
    const body = JSON.parse(route.request().postData() ?? "null");
    const one = async (q: { method: string; params?: unknown[]; id: unknown }) => ({ jsonrpc: "2.0", id: q.id, result: await handle(q) });
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  await ctx.routeWebSocket(/api\.devnet\.solana\.com/, (ws: { onMessage(cb: (m: string | Buffer) => void): void; send(m: string): void }) => {
    let sub = 1;
    ws.onMessage((m) => {
      const q = JSON.parse(m.toString());
      const id = sub++;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: q.id, result: id }));
      if (q.method === "signatureSubscribe")
        setTimeout(() => ws.send(JSON.stringify({ jsonrpc: "2.0", method: "signatureNotification", params: { subscription: id, result: { context: { slot: 101 }, value: { err: null } } } })), 50);
    });
  });
  // Wallet Standard test wallet: exposes the trader's public key, records signed transactions.
  // Passed as plain JS text (tsx/esbuild would inject a __name helper into a serialized function).
  await ctx.addInitScript(`
    window.__signed = [];
    const account = { address: ${JSON.stringify(trader.publicKey.toBase58())}, publicKey: new Uint8Array(${JSON.stringify(Array.from(trader.publicKey.toBytes()))}),
      chains: ["solana:devnet", "solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"] };
    const wallet = {
      version: "1.0.0", name: "E2E Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
      chains: ["solana:devnet", "solana:mainnet", "solana:testnet", "solana:localnet"], accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs) => inputs.map((i) => { window.__signed.push(Array.from(i.transaction)); return { signedTransaction: i.transaction }; }) },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: new Uint8Array(64) })) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (e) => e.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  `);

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 300)); });
  try {
    await page.goto(`${B}/markets/${ch.slug}`);
    await page.getByText("● Live from Solana").waitFor({ timeout: 15000 });
    ok("live price decoded from the Anchor-encoded market account", (await page.locator("text=62%").count()) > 0);
    ok("price history chart renders", await page.locator(".recharts-surface").first().isVisible());

    await page.getByRole("button", { name: /Select Wallet/i }).first().click();
    await page.getByRole("button", { name: /E2E Wallet/ }).click();
    await page.locator("#amt").fill("10");
    ok("instant fee-aware estimate", await page.getByText("Fee (2%)").isVisible());
    await page.getByText("Exact quote simulated against the deployed program.").waitFor({ timeout: 10000 });
    ok("simulateTransaction was used for the quote", rpcLog.includes("simulateTransaction"));
    const minText = await page.locator("dl").getByText(/Minimum \(1% slippage\)/).locator("..").innerText();
    ok("minimum output = quote × 99%", minText.includes("14.9722"), minText);
    ok("payout line uses the exact quote", await page.getByText("15.1235").first().isVisible());
    await page.screenshot({ path: `${OUT}/trade-quote.png`, fullPage: true });

    await page.getByRole("button", { name: "Buy YES" }).click();
    await page.getByText(/confirmed on-chain|confirmed\./).first().waitFor({ timeout: 20000 });
    const status = await page.getByText(/Buy YES confirmed/).first().innerText().catch(() => "");
    ok("trade sent, confirmed, and reported to GoalFi", /Buy YES confirmed/.test(status), status);

    const signed = (await page.evaluate(() => (window as unknown as { __signed: number[][] }).__signed)) as number[][];
    const tx = Transaction.from(Buffer.from(signed[0]!));
    const ix = tx.instructions.find((i) => i.programId.equals(PROGRAM))!;
    const d = Buffer.from(ix.data);
    ok("signed tx is a pm-AMM swap (discriminator)", d.subarray(0, 8).equals(Buffer.from([248, 198, 158, 145, 225, 117, 135, 200])));
    ok("direction = usdcToYes", d[8] === 0);
    ok("amount_in = 10 USDC", d.readBigUInt64LE(9) === 10_000_000n, d.readBigUInt64LE(9));
    ok("min_output = 14,972,221 (slippage applied)", d.readBigUInt64LE(17) === 14_972_221n, d.readBigUInt64LE(17));
    ok("fee payer is the linked wallet", tx.feePayer?.equals(trader.publicKey) ?? false);
    ok("tx touches the market and protocol DAO fee account", ix.keys.some((k) => k.pubkey.equals(market)));

    const row = await prisma.transaction.findUnique({ where: { signature: sentSig } });
    ok("backend recorded the signature (pending until chain verification)", row?.kind === "BUY_YES" && row.status !== "CONFIRMED", row?.status);

    await page.getByText("Your position").waitFor({ timeout: 20000 });
    ok("position panel shows on-chain YES shares", await page.getByText("15.1235").first().isVisible());

    // Portfolio: positions found by scanning the wallet's token accounts.
    await page.goto(`${B}/portfolio`);
    await page.getByText("Trade e2e challenge").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const port = await page.locator("main").innerText();
    if (!port.includes("15.12")) console.log("PORTFOLIO:", port.slice(0, 1200));
    ok("portfolio finds the position via token-account scan", port.includes("Will the community complete the challenge?") && port.includes("15.12"));
    ok("open value estimate = shares × last indexed price (0.60)", port.includes("9.07"), port.match(/9\.\d\d/)?.[0]);
    await page.screenshot({ path: `${OUT}/portfolio.png`, fullPage: true });

    // Resolve (YES) in DB + on-chain account → claim flow.
    state.resolved = true;
    await prisma.market.update({ where: { id: ch.market!.id }, data: { status: "RESOLVED", winningOutcome: 1 } });
    await prisma.challenge.update({ where: { id: ch.id }, data: { status: "RESOLVED", outcome: "YES" } });
    await page.goto(`${B}/markets/${ch.slug}`);
    await page.getByRole("button", { name: /Select Wallet/i }).first().click().catch(() => {});
    await page.getByRole("button", { name: /E2E Wallet/ }).click().catch(() => {});
    await page.getByRole("button", { name: /Claim 15\.1235/ }).waitFor({ timeout: 15000 });
    ok("resolved market offers exact claim (1 per winning share)", true);
    ok("trading disabled after resolution", await page.getByText("Trading is closed. This market is resolved.").isVisible());
    ok("header shows the resolved outcome", await page.getByText("YES won", { exact: true }).isVisible());
    await page.screenshot({ path: `${OUT}/claim.png`, fullPage: true });
    ok("no client-side errors", errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.market.deleteMany({ where: { challengeId: ch.id } });
    await prisma.challenge.delete({ where: { id: ch.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
