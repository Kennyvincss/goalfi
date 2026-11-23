import { openDispute } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`dispute:${user.id}`, 10, 3600);
  const d = await openDispute(services(), actorOf(user), (await params).id, await req.json().catch(() => null));
  return json({ id: d.id }, { status: 201 });
});
