import "dotenv/config";
import http from "node:http";
import { webhookCallback } from "grammy";
import { prisma } from "@goalfi/db";
import { chainTick, lifecycleTick, storageFromEnv, type ServiceContext } from "@goalfi/services";
import { createChainGateway } from "@goalfi/services/chain-gateway";
import { createBot } from "./bot";
import { deliverNotifications, deliverOutbox } from "./dispatch";

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
    appUrl: process.env.GOALFI_APP_URL ?? "http://localhost:3000", now: () => new Date(),
  };
  const bot = createBot(token, svc);
  await bot.api.setMyCommands([
    { command: "dashboard", description: "Your stats and active challenges" },
    { command: "challenges", description: "Active challenges" },
    { command: "markets", description: "Live markets and prices" },
    { command: "leaderboard", description: "Rankings" },
    { command: "submit", description: "Submit evidence" },
    { command: "join", description: "Join this group's GoalFi community" },
    { command: "help", description: "Help" },
  ]);

  // Workers. Each tick is idempotent, so overlapping deploys or the web cron are safe.
  const loop = (name: string, ms: number, fn: () => Promise<unknown>) => {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try { await fn(); } catch (e) { console.error(`[${name}]`, e); } finally { running = false; }
    }, ms);
  };
  loop("lifecycle", 60_000, () => lifecycleTick(svc));
  loop("chain", 60_000, () => chainTick(svc));
  loop("notify", 10_000, () => deliverNotifications(bot.api, svc));
  loop("outbox", 10_000, () => deliverOutbox(bot.api, svc));

  const allowed_updates = ["message", "callback_query", "my_chat_member"] as const;
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
