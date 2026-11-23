import "server-only";
import { Api } from "grammy";
import { prisma } from "@goalfi/db";
import { chainConfigFromEnv, loadAuthorityKeypair, makeConnection } from "@goalfi/chain/server";
import { resolveAppUrl } from "@goalfi/services";
import { services } from "./services";
import { secretProblem, telegramConfigProblems, telegramOnVercel } from "./telegram";

export type CheckStatus = "ok" | "warn" | "error" | "info";
export interface Check {
  area: string;
  status: CheckStatus;
  detail: string;
  /** Plain-language fix, shown when something is wrong. */
  fix?: string;
}

const env = process.env;

function withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);
}

/** Admin-only health checks of the deployment's configuration, in plain language. */
export async function systemStatus(): Promise<Check[]> {
  const checks: Check[] = [];
  const onVercel = !!env.VERCEL;

  // ── Site address ──
  const app = resolveAppUrl(env);
  if (app.source === "GOALFI_APP_URL") checks.push({ area: "Site address", status: "ok", detail: app.url });
  else
    checks.push({
      area: "Site address",
      status: app.url.startsWith("https://") ? "warn" : "error",
      detail: `${app.problem}. Using ${app.url}.`,
      fix: `In Vercel → Settings → Environment Variables, set GOALFI_APP_URL to exactly ${app.url.startsWith("https://") ? app.url : "https://<your-site>.vercel.app"} (with https://, no slash at the end), then Redeploy.`,
    });

  // ── Database ──
  try {
    const users = await prisma.user.count();
    checks.push({ area: "Database", status: "ok", detail: `Connected (${users} users)` });
  } catch (e) {
    checks.push({ area: "Database", status: "error", detail: (e as Error).message.slice(0, 200), fix: "Check DATABASE_URL in Vercel and that the Neon database is connected (Storage tab)." });
  }

  // ── Solana network ──
  let cfgOk = false;
  try {
    const cfg = chainConfigFromEnv(env);
    cfgOk = true;
    const pub = env.NEXT_PUBLIC_GOALFI_CLUSTER ?? "devnet";
    if (pub !== cfg.cluster)
      checks.push({ area: "Solana network", status: "error", detail: `GOALFI_CLUSTER is ${cfg.cluster} but NEXT_PUBLIC_GOALFI_CLUSTER is ${pub}`, fix: "Set both to devnet, then Redeploy." });
    else checks.push({ area: "Solana network", status: "ok", detail: `${cfg.cluster} via ${cfg.rpcUrl}` });
  } catch (e) {
    checks.push({ area: "Solana network", status: "error", detail: (e as Error).message, fix: "Set GOALFI_CLUSTER=devnet and GOALFI_RPC_URL=https://api.devnet.solana.com, then Redeploy." });
  }

  // ── Market key ──
  if (!env.GOALFI_MARKET_AUTHORITY_SECRET) {
    checks.push({ area: "Market key", status: "error", detail: "GOALFI_MARKET_AUTHORITY_SECRET is not set: markets can't be created", fix: "Add your GoalFi wallet's private key (Step 2 of the guide) as GOALFI_MARKET_AUTHORITY_SECRET, then Redeploy." });
  } else {
    try {
      const kp = loadAuthorityKeypair(env.GOALFI_MARKET_AUTHORITY_SECRET);
      const addr = kp.publicKey.toBase58();
      if (cfgOk) {
        try {
          const sol = (await withTimeout(makeConnection(chainConfigFromEnv(env)).getBalance(kp.publicKey))) / 1e9;
          checks.push(
            sol >= 0.5
              ? { area: "Market key", status: "ok", detail: `${addr} has ${sol.toFixed(3)} SOL` }
              : { area: "Market key", status: sol > 0.05 ? "warn" : "error", detail: `${addr} has only ${sol.toFixed(3)} SOL; creating markets costs SOL for account rent`, fix: `Get free devnet SOL for ${addr} at https://faucet.solana.com` },
          );
        } catch (e) {
          checks.push({ area: "Market key", status: "warn", detail: `${addr}: couldn't read balance (${(e as Error).message})`, fix: "If this persists, the Solana RPC may be down or rate-limited." });
        }
      } else checks.push({ area: "Market key", status: "ok", detail: addr });
    } catch (e) {
      checks.push({ area: "Market key", status: "error", detail: (e as Error).message, fix: "GOALFI_MARKET_AUTHORITY_SECRET must be the private key exported from Phantom (a long string of letters and numbers), pasted with no spaces." });
    }
  }
  if (!services().gateway && env.GOALFI_MARKET_AUTHORITY_SECRET)
    checks.push({ area: "Markets", status: "error", detail: "Market features are disabled because the chain settings above have a problem.", fix: "Fix the errors above, then Redeploy." });

  // ── Evidence storage ──
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "supabase") {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !env[k]);
    checks.push(missing.length
      ? { area: "Evidence storage", status: "error", detail: `Missing ${missing.join(", ")}`, fix: "Add them from Supabase → Project Settings → API Keys (use the secret key), then Redeploy." }
      : { area: "Evidence storage", status: "ok", detail: `Supabase bucket “${env.SUPABASE_BUCKET ?? "evidence"}”` });
    if (env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("sb_publishable_"))
      checks.push({ area: "Evidence storage", status: "error", detail: "SUPABASE_SERVICE_ROLE_KEY is the publishable key", fix: "Use the secret key (starts with sb_secret_) or the legacy service_role key." });
  } else {
    checks.push(onVercel
      ? { area: "Evidence storage", status: "error", detail: "Using local disk, which doesn't keep files on Vercel", fix: "Set STORAGE_DRIVER=supabase and the Supabase variables, then Redeploy." }
      : { area: "Evidence storage", status: "ok", detail: "Local disk" });
  }

  // ── Telegram ──
  const token = env.TELEGRAM_BOT_TOKEN;
  const widgetName = (env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
  if (!token) {
    checks.push({ area: "Telegram bot", status: "error", detail: "TELEGRAM_BOT_TOKEN is not set", fix: "Add the token from @BotFather, then Redeploy." });
  } else {
    const api = new Api(token, env.TELEGRAM_API_ROOT ? { apiRoot: env.TELEGRAM_API_ROOT } : undefined);
    try {
      const me = await withTimeout(api.getMe());
      checks.push({ area: "Telegram bot", status: "ok", detail: `@${me.username}` });
      if (!widgetName)
        checks.push({ area: "Telegram login", status: "error", detail: "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not set, so the login button can't load", fix: `Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=${me.username} (no @), then Redeploy.` });
      else if (widgetName.toLowerCase() !== (me.username ?? "").toLowerCase())
        checks.push({ area: "Telegram login", status: "error", detail: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is “${widgetName}” but the token belongs to @${me.username}`, fix: `Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=${me.username} (no @), then Redeploy.` });
      else
        checks.push({ area: "Telegram login", status: "info", detail: `Login button uses @${me.username}. It only works on the domain set with @BotFather /setdomain.`, fix: `If the login button is missing or says “Bot domain invalid”: in @BotFather send /setdomain, pick @${me.username}, send ${new URL(app.url).host}` });

      if (telegramOnVercel()) {
        const problems = telegramConfigProblems();
        // Configuration problems come first; the connection can't be made until they're fixed.
        const info = problems.length ? null : await withTimeout(api.getWebhookInfo());
        if (!info) checks.push({ area: "Telegram connection", status: "error", detail: problems.join("; "), fix: "Fix this in Vercel → Settings → Environment Variables, then Deployments → ⋯ → Redeploy. Telegram connects automatically within a minute after that." });
        else {
        const expected = new URL("/api/telegram/webhook", app.url).toString();
        if (!info.url)
          checks.push({ area: "Telegram connection", status: "error", detail: "Telegram isn't connected to this site yet", fix: "The scheduler connects it automatically each minute. Check the Scheduler row below." });
        else if (info.url !== expected)
          checks.push({ area: "Telegram connection", status: "warn", detail: `Telegram sends messages to ${info.url}, expected ${expected}`, fix: "Will be corrected automatically on the next scheduler run if this site's address is right." });
        else if (info.last_error_message && (info.last_error_date ?? 0) * 1000 > Date.now() - 30 * 60_000)
          checks.push({ area: "Telegram connection", status: "error", detail: `Telegram reports: ${info.last_error_message}`, fix: /401/.test(info.last_error_message) ? "TELEGRAM_WEBHOOK_SECRET changed: the next scheduler run re-connects automatically." : "Check the Vercel logs for /api/telegram/webhook." });
        else checks.push({ area: "Telegram connection", status: "ok", detail: `Connected (${info.pending_update_count} messages waiting)` });
        }
      } else {
        checks.push({ area: "Telegram connection", status: "info", detail: "TELEGRAM_RUN_ON_VERCEL is not set: a separate bot process (Railway) must be running", fix: "For the free setup, set TELEGRAM_RUN_ON_VERCEL=1, TELEGRAM_WEBHOOK_SECRET and CRON_SECRET, then Redeploy." });
      }
    } catch (e) {
      checks.push({ area: "Telegram bot", status: "error", detail: `Telegram rejected the token or is unreachable (${(e as Error).message})`, fix: "Copy the token again from @BotFather into TELEGRAM_BOT_TOKEN, then Redeploy." });
    }
  }

  // ── Scheduler ──
  const hb = await prisma.platformSetting.findUnique({ where: { key: "scheduler.lastRun" } }).catch(() => null);
  const at = hb ? new Date((hb.value as { at: string }).at) : null;
  const mins = at ? (Date.now() - at.getTime()) / 60_000 : Infinity;
  const cronProblem = secretProblem("CRON_SECRET", env.CRON_SECRET);
  if (cronProblem && telegramOnVercel())
    checks.push({ area: "Scheduler", status: "error", detail: cronProblem, fix: "Fix CRON_SECRET in Vercel, Redeploy, and use the same value in cron-job.org's Authorization header (Bearer …)." });
  checks.push(
    !at
      ? { area: "Scheduler", status: "error", detail: "Has never run", fix: `cron-job.org should call ${app.url}/api/cron/tick every minute with header Authorization: Bearer <CRON_SECRET>. If its history shows 401, the header value doesn't match CRON_SECRET.` }
      : mins > 5
        ? { area: "Scheduler", status: "warn", detail: `Last ran ${Math.round(mins)} minutes ago`, fix: "Check the cron-job.org job is enabled and its history shows 200." }
        : { area: "Scheduler", status: "ok", detail: `Last ran ${mins < 1 ? "under a minute" : `${Math.round(mins)} min`} ago` },
  );
  return checks;
}
