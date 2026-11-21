import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

const globalForPrisma = globalThis as unknown as { __goalfiPrisma?: PrismaClient };

function getClient(): PrismaClient {
  if (globalForPrisma.__goalfiPrisma) return globalForPrisma.__goalfiPrisma;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  // Reuse one client per process (also across hot reloads in dev, and warm serverless invocations).
  globalForPrisma.__goalfiPrisma = client;
  return client;
}

/**
 * Prisma client singleton, created on first use. Importing this module never needs a database,
 * so builds (e.g. `next build` on Vercel) work without DATABASE_URL.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
