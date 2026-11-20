import { joinChallenge, leaveChallenge } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  await rateLimit(`join:${user.id}`, 30, 600);
  await joinChallenge(services(), actorOf(user), (await params).id);
  return json({ ok: true }, { status: 201 });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  await leaveChallenge(services(), actorOf(user), (await params).id);
  return json({ ok: true });
});
