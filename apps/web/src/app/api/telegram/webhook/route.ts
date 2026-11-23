import { telegramConfigProblems, telegramOnVercel, telegramWebhookHandler } from "@/lib/server/telegram";

export const maxDuration = 30;

/** Telegram delivers bot updates here (webhook mode). grammY verifies the secret-token header. */
export async function POST(req: Request): Promise<Response> {
  if (!telegramOnVercel()) return new Response("Telegram webhook mode is not enabled", { status: 404 });
  if (telegramConfigProblems().length) return new Response("Telegram is not configured", { status: 503 });
  try {
    return await telegramWebhookHandler()(req);
  } catch (e) {
    // Acknowledge anyway so Telegram doesn't retry a failing update forever; the error is logged.
    console.error("[telegram webhook]", e);
    return new Response("ok", { status: 200 });
  }
}
