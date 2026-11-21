import { createCommunity } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`community:${user.id}`, 5, 3600);
  const c = await createCommunity(services(), actorOf(user), await req.json().catch(() => null));
  return json({ id: c.id, slug: c.slug }, { status: 201 });
});
