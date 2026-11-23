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

/** Explain exactly what's wrong with a secret (admin-only diagnostics; never echoes the value). */
export function secretProblem(name: string, raw: string | undefined, minLength = 16): string | null {
  const value = (raw ?? "").trim();
  if (!value) return `${name} is not set for this environment (in Vercel, make sure it's ticked for Production, then Redeploy)`;
  const bad = [...new Set(value.replace(/[A-Za-z0-9_-]/g, ""))];
  if (bad.length) return `${name} contains characters that aren't allowed: ${bad.map((c) => (c === " " ? "space" : `“${c}”`)).join(" ")}. Use only letters, numbers, _ or -`;
  if (value.length < minLength) return `${name} is only ${value.length} characters long; use at least ${minLength}`;
  return null;
}

function config() {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  // Trim: a trailing space or newline from copy-paste is the most common mistake.
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const appUrl = resolveAppUrl(process.env).url;
  const problems: string[] = [];
  if (!token) problems.push("TELEGRAM_BOT_TOKEN is not set");
  const sp = secretProblem("TELEGRAM_WEBHOOK_SECRET", secret);
  if (sp) problems.push(sp);
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
  if (!cfg.token) return { ok: false, problems: cfg.problems };
  const api = getBot().api;
  const ctx = services();
  // Sending only needs the bot token, so queued messages go out even if the webhook setup has a problem.
  const notifications = await deliverNotifications(api, ctx);
  const outbox = await deliverOutbox(api, ctx);
  if (cfg.problems.length) return { ok: false, problems: cfg.problems, notifications, outbox };
  const info = await api.getWebhookInfo();
  // Re-register if the URL differs, or Telegram reports our endpoint rejecting it (e.g. secret changed).
  const rejected = /401|403|404/.test(info.last_error_message ?? "") && (info.last_error_date ?? 0) * 1000 > Date.now() - 10 * 60_000;
  let webhook: "ok" | "registered" = "ok";
  if (info.url !== cfg.url || rejected) {
    await api.setWebhook(cfg.url, { secret_token: cfg.secret, allowed_updates: [...ALLOWED_UPDATES] });
    await api.setMyCommands(BOT_COMMANDS);
    webhook = "registered";
  }
  return { ok: true, webhook, pendingUpdates: info.pending_update_count, notifications, outbox };
}
