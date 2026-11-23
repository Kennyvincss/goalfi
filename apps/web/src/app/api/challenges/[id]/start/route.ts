import { startChallengeNow } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

/** Start an upcoming challenge immediately (challenge admins). */
export const POST = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  await startChallengeNow(services(), actorOf(user), (await params).id);
  return json({ ok: true });
});
