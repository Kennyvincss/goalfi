import { timingSafeEqual } from "node:crypto";
import { chainTick, lifecycleTick } from "@goalfi/services";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { services } from "@/lib/server/services";

/**
 * Scheduler endpoint for hosts without a persistent worker (e.g. Vercel Cron).
 * The Telegram bot process runs the same ticks on its own; running both is safe (idempotent).
 */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) throw new HttpError(401, "Unauthorized");
  const ctx = services();
  return json({ lifecycle: await lifecycleTick(ctx), chain: await chainTick(ctx) });
});
