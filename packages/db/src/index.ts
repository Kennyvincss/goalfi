import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { __goalfiPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Singleton Prisma client (reused across hot reloads in dev). */
export const prisma: PrismaClient = globalForPrisma.__goalfiPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__goalfiPrisma = prisma;
