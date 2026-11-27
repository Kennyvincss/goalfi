import { completeOnboarding } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

/** Finish or dismiss the getting-started steps. */
export const POST = route(async () => {
  const user = await requireUser();
  await completeOnboarding(services(), actorOf(user));
  return json({ ok: true });
});
