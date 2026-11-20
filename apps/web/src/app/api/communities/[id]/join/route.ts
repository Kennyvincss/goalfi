import { joinCommunity } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`community-join:${user.id}`, 20, 600);
  const body = (await req.json().catch(() => ({}))) as { invite?: string };
  await joinCommunity(services(), actorOf(user), (await params).id, body.invite);
  return json({ ok: true }, { status: 201 });
});
