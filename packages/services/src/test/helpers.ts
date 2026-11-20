import { prisma } from "@goalfi/db";
import type { Actor, ServiceContext } from "../context";
import type { EvidenceStorage } from "../storage";
import { sha256Hex } from "../storage";
import { FakeGateway } from "./fake-gateway";

export class MemoryStorage implements EvidenceStorage {
  objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  async put(bytes: Uint8Array, mimeType: string, challengeId: string) {
    const sha256 = sha256Hex(bytes);
    const key = `${challengeId}/${sha256}`;
    this.objects.set(key, { bytes, mimeType });
    return { key, sha256, sizeBytes: bytes.byteLength };
  }
  async get(key: string) { return this.objects.get(key) ?? null; }
}

export function makeCtx(start = new Date()) {
  const clock = { now: start };
  const gateway = new FakeGateway(() => clock.now);
  const ctx: ServiceContext = { db: prisma, gateway, storage: new MemoryStorage(), appUrl: "https://goalfi.test", now: () => clock.now };
  return { ctx, gateway, clock, advance: (ms: number) => (clock.now = new Date(clock.now.getTime() + ms)) };
}

let n = 0;
export async function makeUser(name: string, extra: Partial<{ walletAddress: string; telegramId: bigint; role: "USER" | "PLATFORM_ADMIN" }> = {}): Promise<Actor> {
  const username = `${name}_${process.pid}_${++n}`.slice(0, 24).toLowerCase();
  const u = await prisma.user.create({ data: { username, ...extra } });
  return { id: u.id, username: u.username, role: u.role, walletAddress: u.walletAddress };
}

export async function resetDb() {
  // Truncate everything except migrations (test DB only). Triggers block DELETE on audit_logs, so use TRUNCATE.
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("goalfi_test")) throw new Error("refusing to reset a non-test database");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  for (const [i, slug] of ["fitness", "education", "community"].entries())
    await prisma.category.create({ data: { slug, name: slug, sortOrder: i } });
}
