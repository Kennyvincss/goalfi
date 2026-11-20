import { submitUserTransaction } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

/** The wallet sent a tx; record it PENDING and verify on-chain before anything counts. */
export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`tx:${user.id}`, 60, 600);
  const t = await submitUserTransaction(services(), actorOf(user), await req.json().catch(() => null));
  return json({ id: t.id, status: t.status, error: t.error }, { status: t.status === "PENDING" ? 202 : 200 });
});
