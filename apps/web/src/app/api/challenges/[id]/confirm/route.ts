import { confirmChallenge } from "@goalfi/services";
import { requireUser } from "@/lib/server/auth";
import { json, rateLimit, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";

type Ctx = { params: Promise<{ id: string }> };

/** Creator confirms the rules → challenge published, or on-chain market created. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`confirm:${user.id}`, 10, 600);
  const body = (await req.json().catch(() => ({}))) as { acceptRules?: boolean };
  if (body.acceptRules !== true) return json({ error: "You must confirm the rules" }, { status: 422 });
  const r = await confirmChallenge(services(), actorOf(user), (await params).id);
  return json({ status: r.challenge.status, market: r.market && { status: r.market.status, address: r.market.marketAddress } });
});
