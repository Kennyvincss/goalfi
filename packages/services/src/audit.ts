import type { Prisma } from "@goalfi/db";
import type { ServiceContext } from "./context";

type Db = ServiceContext["db"] | Prisma.TransactionClient;

export async function audit(db: Db, actorId: string | null, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { actorId, action, entityType, entityId, metadata } });
}
