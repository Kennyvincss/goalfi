import { retryMarketCreation } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  await rateLimit(`retry-market:${user.id}`, 10, 600);
  const m = await retryMarketCreation(services(), actorOf(user), (await params).id);
  return json({ status: m.status, address: m.marketAddress });
});
