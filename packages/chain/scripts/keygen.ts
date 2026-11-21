/** Generate devnet-only keypairs for the platform authority and an e2e trader. Never use for mainnet. */
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const dir = path.resolve(__dirname, "../../../.devnet-keys");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
for (const name of ["authority", "trader"]) {
  const file = path.join(dir, `${name}.json`);
  if (fs.existsSync(file)) {
    console.log(`${name}: exists (${JSON.parse(fs.readFileSync(file, "utf8")).publicKey})`);
    continue;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify({ publicKey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) }), { mode: 0o600 });
  console.log(`${name}: ${kp.publicKey.toBase58()}  → ${file}`);
}
console.log("\nFund both with devnet SOL (https://faucet.solana.com) and mUSDC (see predict-pm-amm.dev).");
console.log("For the web app, set GOALFI_MARKET_AUTHORITY_SECRET to the authority 'secret' value.");
