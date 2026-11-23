import { DEFAULT_TRUST_MIN_ACCOUNT_DAYS } from "@goalfi/core";
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
  /** Minimum account age (days) to join challenges with a market and to count as a community member. Default 7. */
  trustMinAccountDays?: number;
}

export interface Actor {
  id: string;
  username: string;
  role: "USER" | "PLATFORM_ADMIN";
  walletAddress: string | null;
}

export function trustDays(ctx: ServiceContext): number {
  return ctx.trustMinAccountDays ?? DEFAULT_TRUST_MIN_ACCOUNT_DAYS;
}

export function link(ctx: ServiceContext, path: string): string {
  return new URL(path, ctx.appUrl).toString();
}
