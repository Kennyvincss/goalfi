import { Connection, PublicKey, type Commitment } from "@solana/web3.js";

export type ClusterName = "devnet" | "mainnet-beta";

/**
 * Official pm-AMM deployments (from @pm-amm/sdk@0.2.0 llms.txt). The program id is the same
 * on both clusters; only the collateral mint differs. Never mix these.
 */
export const PM_AMM_DEPLOYMENTS = {
  devnet: {
    programId: "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
    collateralMint: "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ",
    collateralSymbol: "mUSDC",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    dbCluster: "DEVNET",
  },
  "mainnet-beta": {
    programId: "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
    collateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    collateralSymbol: "USDC",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    dbCluster: "MAINNET",
  },
} as const;

export const COLLATERAL_DECIMALS = 6;

export interface ChainConfig {
  readonly cluster: ClusterName;
  readonly rpcUrl: string;
  readonly programId: PublicKey;
  readonly collateralMint: PublicKey;
  readonly collateralSymbol: string;
  readonly genesisHash: string;
  readonly dbCluster: "DEVNET" | "MAINNET";
  readonly commitment: Commitment;
}

export const MAINNET_OPT_IN = "I_UNDERSTAND_THE_RISKS";

export function chainConfig(cluster: ClusterName, rpcUrl: string, opts: { mainnetOptIn?: string } = {}): ChainConfig {
  const d = PM_AMM_DEPLOYMENTS[cluster];
  if (!d) throw new Error(`Unknown cluster "${cluster}" (expected devnet | mainnet-beta)`);
  if (cluster === "mainnet-beta" && opts.mainnetOptIn !== MAINNET_OPT_IN)
    throw new Error(
      "Mainnet is disabled. Real-money trading requires security, legal and regulatory review " +
        `and GOALFI_ENABLE_MAINNET=${MAINNET_OPT_IN}.`,
    );
  // Cheap guard against pointing a devnet config at a mainnet RPC (or vice versa).
  const url = rpcUrl.toLowerCase();
  if (cluster === "devnet" && url.includes("mainnet")) throw new Error("devnet config with a mainnet RPC URL");
  if (cluster === "mainnet-beta" && (url.includes("devnet") || url.includes("testnet")))
    throw new Error("mainnet config with a devnet/testnet RPC URL");
  return Object.freeze({
    cluster,
    rpcUrl,
    programId: new PublicKey(d.programId),
    collateralMint: new PublicKey(d.collateralMint),
    collateralSymbol: d.collateralSymbol,
    genesisHash: d.genesisHash,
    dbCluster: d.dbCluster,
    commitment: "confirmed" as Commitment,
  });
}

/** Server-side config from env (GOALFI_CLUSTER / GOALFI_RPC_URL / GOALFI_ENABLE_MAINNET). */
export function chainConfigFromEnv(env: Record<string, string | undefined> = process.env): ChainConfig {
  const cluster = (env.GOALFI_CLUSTER ?? "devnet") as ClusterName;
  const rpc = env.GOALFI_RPC_URL ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : "");
  if (!rpc) throw new Error("GOALFI_RPC_URL is required");
  return chainConfig(cluster, rpc, { mainnetOptIn: env.GOALFI_ENABLE_MAINNET });
}

export function makeConnection(cfg: ChainConfig): Connection {
  return new Connection(cfg.rpcUrl, { commitment: cfg.commitment });
}

/** Strong guard: the RPC's genesis hash must match the configured cluster. Run at boot. */
export async function assertClusterMatches(connection: Connection, cfg: ChainConfig): Promise<void> {
  const hash = await connection.getGenesisHash();
  if (hash !== cfg.genesisHash)
    throw new Error(`RPC genesis hash ${hash} does not match ${cfg.cluster} (${cfg.genesisHash}). Refusing to run.`);
}

export function explorerTxUrl(cfg: ChainConfig, signature: string): string {
  return `https://solscan.io/tx/${signature}${cfg.cluster === "devnet" ? "?cluster=devnet" : ""}`;
}
export function explorerAccountUrl(cfg: ChainConfig, address: string): string {
  return `https://solscan.io/account/${address}${cfg.cluster === "devnet" ? "?cluster=devnet" : ""}`;
}
