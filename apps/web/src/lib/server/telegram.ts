import "server-only";
import { webhookCallback, type Bot } from "grammy";
import { ALLOWED_UPDATES, BOT_COMMANDS, createBot, deliverNotifications, deliverOutbox } from "@goalfi/bot";
import { resolveAppUrl } from "@goalfi/services";
import { services } from "./services";

/**
 * "Bot on Vercel" mode (free hosting): Telegram pushes updates to /api/telegram/webhook, and the
 * scheduled /api/cron/tick delivers notifications and keeps the webhook registered.
 * Enable with TELEGRAM_RUN_ON_VERCEL=1. Don't also run the standalone bot process (apps/bot).
 */
export function telegramOnVercel(): boolean {
  return ["1", "true", "yes"].includes((process.env.TELEGRAM_RUN_ON_VERCEL ?? "").toLowerCase());
}

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const appUrl = resolveAppUrl(process.env).url;
  const problems: string[] = [];
  if (!token) problems.push("TELEGRAM_BOT_TOKEN is not set");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) problems.push("TELEGRAM_WEBHOOK_SECRET must be 16+ letters/numbers (A-Z, a-z, 0-9, _ or -)");
  if (!appUrl.startsWith("https://")) problems.push("GOALFI_APP_URL must be your https:// site address (Telegram only calls https)");
  return { token, secret, url: new URL("/api/telegram/webhook", appUrl).toString(), problems };
}

let bot: Bot | undefined;
let handler: ((req: Request) => Promise<Response>) | undefined;

function getBot(): Bot {
  bot ??= createBot(config().token, services(), { apiRoot: process.env.TELEGRAM_API_ROOT || undefined });
  return bot;
}

export function telegramWebhookHandler(): (req: Request) => Promise<Response> {
  handler ??= webhookCallback(getBot(), "std/http", { secretToken: config().secret, timeoutMilliseconds: 25_000 });
  return handler;
}

export function telegramConfigProblems(): string[] {
  return config().problems;
}

/** Runs on every scheduler tick: make sure Telegram points at us, then deliver queued messages. */
export async function telegramTick() {
  const cfg = config();
  if (cfg.problems.length) return { ok: false, problems: cfg.problems };
  const api = getBot().api;
  const info = await api.getWebhookInfo();
  // Re-register if the URL differs, or Telegram reports our endpoint rejecting it (e.g. secret changed).
  const rejected = /401|403|404/.test(info.last_error_message ?? "") && (info.last_error_date ?? 0) * 1000 > Date.now() - 10 * 60_000;
  let webhook: "ok" | "registered" = "ok";
  if (info.url !== cfg.url || rejected) {
    await api.setWebhook(cfg.url, { secret_token: cfg.secret, allowed_updates: [...ALLOWED_UPDATES] });
    await api.setMyCommands(BOT_COMMANDS);
    webhook = "registered";
  }
  const ctx = services();
  const notifications = await deliverNotifications(api, ctx);
  const outbox = await deliverOutbox(api, ctx);
  return { ok: true, webhook, pendingUpdates: info.pending_update_count, notifications, outbox };
}
