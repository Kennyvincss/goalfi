import "server-only";
import { prisma } from "@goalfi/db";
import { resolveAppUrl, storageFromEnv, type Actor, type MarketGateway, type ServiceContext } from "@goalfi/services";
import { createChainGateway } from "@goalfi/services/chain-gateway";
import type { SessionUser } from "./auth";

let gateway: MarketGateway | null | undefined;
function getGateway(): MarketGateway | null {
  if (gateway === undefined) {
    try {
      gateway = createChainGateway(process.env);
    } catch (e) {
      console.error("[chain] gateway disabled:", (e as Error).message);
      gateway = null;
    }
  }
  return gateway;
}

let ctx: ServiceContext | undefined;
export function services(): ServiceContext {
  ctx ??= {
    db: prisma,
    gateway: getGateway(),
    storage: storageFromEnv(process.env),
    appUrl: resolveAppUrl(process.env).url,
    now: () => new Date(),
  };
  return ctx;
}

export function actorOf(u: SessionUser): Actor {
  return { id: u.id, username: u.username, role: u.role, walletAddress: u.walletAddress };
}
