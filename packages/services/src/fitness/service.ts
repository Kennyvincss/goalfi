import { createHash } from "node:crypto";
import { civilDayInWindow, SuccessRuleSchema } from "@goalfi/core";
import type { Prisma } from "@goalfi/db";
import { link, type Actor, type ServiceContext } from "../context";
import { notify } from "../notifications";
import { audit } from "../audit";
import { decryptToken, encryptToken } from "./crypto";
import {
  exchangeCode,
  fetchDailySteps,
  GoogleHealthError,
  refreshAccessToken,
  revokeToken,
  type Fetch,
  type GoogleHealthConfig,
} from "./google-health";

export const CONNECTED_APP_DECISION = "CONNECTED_APP";
/** Keep syncing this long after a challenge ends, because watches upload late. Settlement waits for it. */
export const SYNC_GRACE_HOURS = 2;
const MIN_SYNC_INTERVAL_MS = 10 * 60_000;
const DAY = 86_400_000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DAY));

export async function getFitnessConnection(ctx: ServiceContext, userId: string) {
  return ctx.db.fitnessConnection.findUnique({ where: { userId_provider: { userId, provider: "GOOGLE_HEALTH" } } });
}

/** OAuth callback: store encrypted tokens, then pull the last 14 days for suggestions. */
export async function connectGoogleHealth(ctx: ServiceContext, actor: Actor, cfg: GoogleHealthConfig, code: string, f: Fetch = fetch) {
  const t = await exchangeCode(cfg, code, f);
  const existing = await getFitnessConnection(ctx, actor.id);
  const refresh = t.refreshToken ?? (existing?.refreshTokenEnc ? decryptToken(existing.refreshTokenEnc, cfg.tokenKey) : null);
  const data = {
    accessTokenEnc: encryptToken(t.accessToken, cfg.tokenKey),
    refreshTokenEnc: refresh ? encryptToken(refresh, cfg.tokenKey) : null,
    expiresAt: t.expiresAt,
    scope: t.scope,
    status: "ACTIVE",
    lastError: null,
  };
  await ctx.db.fitnessConnection.upsert({
    where: { userId_provider: { userId: actor.id, provider: "GOOGLE_HEALTH" } },
    update: data,
    create: { userId: actor.id, provider: "GOOGLE_HEALTH", ...data },
  });
  await audit(ctx.db, actor.id, "fitness.connected", "User", actor.id, { provider: "GOOGLE_HEALTH" });
  const today = isoDay(ctx.now());
  await syncUserSteps(ctx, cfg, actor.id, addDays(today, -13), addDays(today, 1), f, true).catch(() => undefined);
}

export async function disconnectFitness(ctx: ServiceContext, actor: Actor, cfg: GoogleHealthConfig | null, f: Fetch = fetch) {
  const c = await getFitnessConnection(ctx, actor.id);
  if (!c) return;
  if (cfg) {
    const token = c.refreshTokenEnc ?? c.accessTokenEnc;
    try {
      await revokeToken(decryptToken(token, cfg.tokenKey), f);
    } catch {
      // Revocation is best-effort; the connection is removed either way.
    }
  }
  await ctx.db.$transaction([
    ctx.db.fitnessConnection.delete({ where: { id: c.id } }),
    // Raw daily data is removed; evidence already used in challenges stays (it is the audit trail).
    ctx.db.fitnessDaily.deleteMany({ where: { userId: actor.id, provider: "GOOGLE_HEALTH" } }),
  ]);
  await audit(ctx.db, actor.id, "fitness.disconnected", "User", actor.id, { provider: "GOOGLE_HEALTH" });
}

async function accessToken(ctx: ServiceContext, cfg: GoogleHealthConfig, userId: string, f: Fetch): Promise<string> {
  const c = await getFitnessConnection(ctx, userId);
  if (!c || c.status === "REVOKED") throw new GoogleHealthError("Not connected", 401, true);
  if (c.expiresAt.getTime() - ctx.now().getTime() > 60_000) return decryptToken(c.accessTokenEnc, cfg.tokenKey);
  if (!c.refreshTokenEnc) throw new GoogleHealthError("Access expired: reconnect Google Health", 401, true);
  const t = await refreshAccessToken(cfg, decryptToken(c.refreshTokenEnc, cfg.tokenKey), f);
  await ctx.db.fitnessConnection.update({
    where: { id: c.id },
    data: {
      accessTokenEnc: encryptToken(t.accessToken, cfg.tokenKey),
      expiresAt: t.expiresAt,
      ...(t.refreshToken ? { refreshTokenEnc: encryptToken(t.refreshToken, cfg.tokenKey) } : {}),
    },
  });
  return t.accessToken;
}

/** Pull daily steps for [startIso, endIsoExclusive) and store them. Returns rows stored. */
export async function syncUserSteps(ctx: ServiceContext, cfg: GoogleHealthConfig, userId: string, startIso: string, endIsoExclusive: string, f: Fetch = fetch, force = false) {
  const c = await getFitnessConnection(ctx, userId);
  if (!c || c.status === "REVOKED") return 0;
  if (!force && c.lastSyncAt && ctx.now().getTime() - c.lastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) return 0;
  try {
    const token = await accessToken(ctx, cfg, userId, f);
    const rows = await fetchDailySteps(token, startIso, endIsoExclusive, f);
    for (const r of rows) {
      await ctx.db.fitnessDaily.upsert({
        where: { userId_provider_date_metric: { userId, provider: "GOOGLE_HEALTH", date: new Date(`${r.date}T00:00:00Z`), metric: "steps" } },
        update: { value: r.value, fetchedAt: ctx.now() },
        create: { userId, provider: "GOOGLE_HEALTH", date: new Date(`${r.date}T00:00:00Z`), metric: "steps", value: r.value },
      });
    }
    await ctx.db.fitnessConnection.update({ where: { id: c.id }, data: { lastSyncAt: ctx.now(), status: "ACTIVE", lastError: null } });
    return rows.length;
  } catch (e) {
    const reconnect = e instanceof GoogleHealthError && e.reconnect;
    await ctx.db.fitnessConnection.update({
      where: { id: c.id },
      data: { lastSyncAt: ctx.now(), status: reconnect ? "ERROR" : c.status, lastError: (e as Error).message.slice(0, 300) },
    });
    if (reconnect)
      await notify(ctx.db, [userId], {
        type: "MARKET_UPDATE",
        message: "GoalFi lost access to your Google Health data. Reconnect in Settings so your steps keep counting.",
        link: link(ctx, "/settings#fitness"),
        dedupKey: `FITNESS_RECONNECT:${userId}:${isoDay(ctx.now())}`,
      });
    return 0;
  }
}

/** Recent daily steps (oldest first) for suggestions and the settings page. */
export async function recentDailySteps(ctx: ServiceContext, userId: string, days = 14) {
  const since = new Date(new Date(`${isoDay(ctx.now())}T00:00:00Z`).getTime() - (days - 1) * DAY);
  const rows = await ctx.db.fitnessDaily.findMany({ where: { userId, metric: "steps", date: { gte: since } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: isoDay(r.date), value: r.value }));
}

type ConnectedChallenge = Prisma.ChallengeGetPayload<{ include: { participants: true } }>;

/**
 * Turn synced daily steps into approved evidence for one participant. Evidence is immutable, so a
 * changed daily total creates a new row that supersedes the previous one.
 */
async function materialize(ctx: ServiceContext, c: ConnectedChallenge, userId: string, participantId: string): Promise<number> {
  const rule = SuccessRuleSchema.parse(c.successRule);
  // Fetch a day either side, then keep the local days whose midday is inside the challenge window.
  const days = (
    await ctx.db.fitnessDaily.findMany({
      where: {
        userId, metric: c.fitnessMetric ?? "steps",
        date: { gte: new Date(`${isoDay(new Date(c.startDate.getTime() - DAY))}T00:00:00Z`), lte: new Date(`${isoDay(new Date(c.endDate.getTime() + DAY))}T00:00:00Z`) },
      },
    })
  ).filter((d) => civilDayInWindow(isoDay(d.date), c.startDate, c.endDate));
  let created = 0;
  for (const d of days) {
    const date = isoDay(d.date);
    const qualifies = rule.type === "daily_completion" ? d.value >= (c.fitnessDailyTarget ?? Infinity) : d.value > 0;
    if (!qualifies) continue;
    const current = await ctx.db.evidence.findFirst({
      where: { challengeId: c.id, userId, activityDate: d.date, autoDecision: CONNECTED_APP_DECISION, supersededBy: null },
    });
    if (current && Number(current.progressValue) === d.value) continue;
    await ctx.db.evidence.create({
      data: {
        challengeId: c.id, participantId, userId,
        description: `${d.value.toLocaleString("en-US")} steps on ${date} (synced from Google Health)`,
        links: [], progressValue: d.value, activityDate: d.date,
        contentHash: createHash("sha256").update(`GOOGLE_HEALTH:steps:${userId}:${date}:${d.value}`).digest("hex"),
        status: "APPROVED", decidedAt: ctx.now(), autoDecision: CONNECTED_APP_DECISION,
        supersedesId: current?.id ?? null,
      },
    });
    created++;
  }
  return created;
}

/**
 * Scheduler step: for app-verified challenges that are running (or ended less than SYNC_GRACE_HOURS
 * ago), sync each participant's steps and update their evidence.
 */
export async function fitnessTick(ctx: ServiceContext, cfg: GoogleHealthConfig | null, f: Fetch = fetch) {
  const out = { challenges: 0, synced: 0, evidence: 0, notConnected: 0 };
  if (!cfg) return out;
  const now = ctx.now();
  const challenges = await ctx.db.challenge.findMany({
    where: {
      verificationMethod: "CONNECTED_APP",
      status: { in: ["ACTIVE", "IN_REVIEW"] },
      startDate: { lte: now },
      endDate: { gte: new Date(now.getTime() - SYNC_GRACE_HOURS * 3_600_000) },
    },
    include: { participants: { where: { status: { not: "WITHDRAWN" } } } },
  });
  out.challenges = challenges.length;
  const syncedUsers = new Set<string>();
  for (const c of challenges) {
    for (const p of c.participants) {
      if (!syncedUsers.has(p.userId)) {
        syncedUsers.add(p.userId);
        const conn = await getFitnessConnection(ctx, p.userId);
        if (!conn || conn.status !== "ACTIVE") {
          out.notConnected++;
          await notify(ctx.db, [p.userId], {
            type: "MARKET_UPDATE",
            message: `Connect Google Health so your steps count in “${c.title}”.`,
            link: link(ctx, "/settings#fitness"),
            dedupKey: `CONNECT_FITNESS:${c.id}:${p.userId}`,
          });
        }
        // Sync the widest window this user needs across their running challenges (max 31 days).
        const mine = challenges.filter((x) => x.participants.some((q) => q.userId === p.userId));
        const start = isoDay(new Date(Math.max(Math.min(...mine.map((x) => x.startDate.getTime())) - DAY, now.getTime() - 31 * DAY)));
        out.synced += await syncUserSteps(ctx, cfg, p.userId, start, addDays(isoDay(now), 1), f);
      }
      out.evidence += await materialize(ctx, c, p.userId, p.id);
    }
  }
  return out;
}
