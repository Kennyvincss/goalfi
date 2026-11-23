import type { PrismaClient } from "@goalfi/db";
import type { MarketGateway } from "./gateway";
import type { EvidenceStorage } from "./storage";

export interface ServiceContext {
  db: PrismaClient;
  /** null when no market authority is configured: market features are then unavailable. */
  gateway: MarketGateway | null;
  storage: EvidenceStorage;
  appUrl: string;
  now: () => Date;
}

export interface Actor {
  id: string;
  username: string;
  role: "USER" | "PLATFORM_ADMIN";
  walletAddress: string | null;
}

export function link(ctx: ServiceContext, path: string): string {
  return new URL(path, ctx.appUrl).toString();
}
