import { timingSafeEqual } from "node:crypto";
import { chainTick, fitnessTick, lifecycleTick } from "@goalfi/services";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/api";
import { services } from "@/lib/server/services";
import { telegramOnVercel, telegramTick } from "@/lib/server/telegram";
import { fitnessConfig } from "@/lib/server/fitness";

export const maxDuration = 60;

/**
 * Scheduler endpoint for hosts without a persistent worker: call it every minute from Vercel Cron
 * (Pro) or a free external scheduler such as cron-job.org, with `Authorization: Bearer <CRON_SECRET>`.
 * All work is idempotent, so overlapping calls are safe.
 */
export const GET = route(async (req) => {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) throw new HttpError(401, "Unauthorized");
  const ctx = services();
  const step = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      console.error("[cron]", e);
      return { error: (e as Error).message.slice(0, 300) };
    }
  };
  return json({
    // Fitness first, so freshly synced steps are in place before auto-settlement looks at them.
    fitness: fitnessConfig() ? await step(() => fitnessTick(ctx, fitnessConfig())) : "disabled (Google Health keys not set)",
    lifecycle: await step(() => lifecycleTick(ctx)),
    chain: await step(() => chainTick(ctx)),
    telegram: telegramOnVercel() ? await step(() => telegramTick()) : "disabled (TELEGRAM_RUN_ON_VERCEL not set)",
  });
});
