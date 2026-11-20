import { resolutionReport, resolveChallenge } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  return json(await resolutionReport(services(), actorOf(user), (await params).id));
});

/** Admin confirms the final outcome; backend enforces prerequisites, then resolves on-chain. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`resolve:${user.id}`, 10, 600);
  const c = await resolveChallenge(services(), actorOf(user), (await params).id, await req.json().catch(() => null));
  return json({ status: c.status, outcome: c.outcome });
});
