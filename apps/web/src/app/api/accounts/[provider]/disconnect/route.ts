import { disconnectAccount, providerFromSlug } from "@goalfi/services";
import { HttpError, requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { actorOf, services } from "@/lib/server/services";
import { accountsConfig } from "@/lib/server/accounts";

/** Revoke access and delete stored activity data. Evidence already used in challenges stays. */
export const POST = route(async (_req, { params }: { params: Promise<{ provider: string }> }) => {
  const user = await requireUser();
  const provider = providerFromSlug((await params).provider);
  if (!provider) throw new HttpError(404, "Unknown provider");
  await disconnectAccount(services(), actorOf(user), accountsConfig(), provider);
  return json({ ok: true });
});
