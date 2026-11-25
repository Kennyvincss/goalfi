import "dotenv/config";
import http from "node:http";
import { webhookCallback } from "grammy";
import { prisma } from "@goalfi/db";
import { accountsConfigFromEnv, accountsTick, weeklyIdeasTick, chainTick, lifecycleTick, resolveAppUrl, storageFromEnv, type ServiceContext } from "@goalfi/services";
import { createChainGateway } from "@goalfi/services/chain-gateway";
import { ALLOWED_UPDATES, BOT_COMMANDS, createBot, deliverNotifications, deliverOutbox } from "./lib";

/**
 * GoalFi persistent process: Telegram bot + background workers (scheduler, tx reconciler,
 * market indexer, notification/announcement delivery).
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  let gateway = null;
  try {
    gateway = createChainGateway(process.env);
  } catch (e) {
    console.error("[chain] gateway disabled:", (e as Error).message);
  }
  const svc: ServiceContext = {
    db: prisma, gateway, storage: storageFromEnv(process.env),
    appUrl: resolveAppUrl(process.env).url, now: () => new Date(),
  };
  const bot = createBot(token, svc, { apiRoot: process.env.TELEGRAM_API_ROOT || undefined });
  await bot.api.setMyCommands(BOT_COMMANDS);

  // Workers. Each tick is idempotent, so overlapping deploys or the web cron are safe.
  const loop = (name: string, ms: number, fn: () => Promise<unknown>) => {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try { await fn(); } catch (e) { console.error(`[${name}]`, e); } finally { running = false; }
    }, ms);
  };
  const accountsCfg = accountsConfigFromEnv(svc.appUrl, process.env);
  loop("accounts", 60_000, () => accountsTick(svc, accountsCfg));
  loop("ideas", 10 * 60_000, () => weeklyIdeasTick(svc, accountsCfg));
  loop("lifecycle", 60_000, () => lifecycleTick(svc));
  loop("chain", 60_000, () => chainTick(svc));
  loop("notify", 10_000, () => deliverNotifications(bot.api, svc));
  loop("outbox", 10_000, () => deliverOutbox(bot.api, svc));

  const allowed_updates = ALLOWED_UPDATES;
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");
    await bot.api.setWebhook(process.env.TELEGRAM_WEBHOOK_URL, { secret_token: secret, allowed_updates: [...allowed_updates] });
    const handle = webhookCallback(bot, "http", { secretToken: secret });
    const port = Number(process.env.PORT ?? 8080);
    http.createServer((req, res) => (req.method === "POST" && req.url === "/telegram" ? handle(req, res) : res.writeHead(req.url === "/healthz" ? 200 : 404).end())).listen(port);
    console.log(`[bot] webhook mode on :${port}`);
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: [...allowed_updates], onStart: (me) => console.log(`[bot] @${me.username} polling`) });
  }
  const stop = async () => { await bot.stop(); await prisma.$disconnect(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
