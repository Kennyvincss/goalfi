import { deleteDraft } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  await deleteDraft(services(), actorOf(user), (await params).id);
  return json({ ok: true });
});
