import { disconnectFitness } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";
import { fitnessConfig } from "@/lib/server/fitness";

/** Revoke Google access and delete stored step data. Evidence already used in challenges stays. */
export const POST = route(async () => {
  const user = await requireUser();
  await disconnectFitness(services(), actorOf(user), fitnessConfig());
  return json({ ok: true });
});
