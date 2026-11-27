import { createHash } from "node:crypto";
import {
  appMetric,
  ACCOUNT_PROVIDERS,
  civilDayInWindow,
  combineDaily,
  metricProviders,
  metricSourceLabel,
  describeDailyTarget,
  establishedMember,
  MAX_EVENTS_PER_OPPONENT_PER_DAY,
  formatMetricValue,
  meetsDailyTarget,
  PROVIDER_INFO,
  SuccessRuleSchema,
  type AccountProviderId,
  type AppMetricDef,
} from "@goalfi/core";
import type { Prisma } from "@goalfi/db";
import { link, trustDays, type Actor, type ServiceContext } from "../context";
import { conflict, invalid } from "../errors";
import { notify } from "../notifications";
import { audit } from "../audit";
import { applyStreak } from "../reputation";
import type { AccountsConfig } from "./config";
import { decryptToken, encryptToken } from "./crypto";
import { GOOGLE_SLEEP_SCOPE } from "./google-health";
import { addDays, isoDay, ProviderError, type Fetch } from "./http";
import { telegramMemberCount } from "./telegram-count";

export const CONNECTED_APP_DECISION = "CONNECTED_APP";
/** Keep syncing this long after a challenge ends, because devices upload late. Settlement waits for it. */
export const SYNC_GRACE_HOURS = 2;
const MIN_SYNC_INTERVAL_MS = 10 * 60_000;
const DAY = 86_400_000;

export function getAccount(ctx: ServiceContext, userId: string, provider: AccountProviderId) {
  return ctx.db.connectedAccount.findUnique({ where: { userId_provider: { userId, provider } } });
}

export function listAccounts(ctx: ServiceContext, userId: string) {
  return ctx.db.connectedAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}

/** Whether one account can feed this metric (connected, healthy, with the needed permission). */
export function accountReadyFor(account: { status: string; scope: string; provider?: string } | null, metric: AppMetricDef): boolean {
  if (!account || account.status !== "ACTIVE") return false;
  if (account.provider && !metricProviders(metric).includes(account.provider as AccountProviderId)) return false;
  // Google asks for sleep separately; other sources include it with their activity access.
  if (metric.id === "wake_time" && (account.provider ?? "GOOGLE_HEALTH") === "GOOGLE_HEALTH" && !account.scope.includes(GOOGLE_SLEEP_SCOPE)) return false;
  return true;
}

/** The user's accounts that can supply this metric right now (any of its sources). */
export async function readyAccounts(ctx: ServiceContext, userId: string, metric: AppMetricDef) {
  const providers = metricProviders(metric).filter((p): p is AccountProviderId => (ACCOUNT_PROVIDERS as readonly string[]).includes(p));
  const accounts = await ctx.db.connectedAccount.findMany({ where: { userId, provider: { in: providers } } });
  return accounts.filter((a) => accountReadyFor(a, metric));
}

function client(cfg: AccountsConfig, provider: AccountProviderId) {
  const c = cfg.providers[provider];
  if (!c) throw invalid(`${PROVIDER_INFO[provider].name} isn't set up on this server`);
  return c;
}

/** Start sign-in: the URL to redirect to, plus a PKCE verifier to keep until the callback (Lichess). */
export function startConnect(cfg: AccountsConfig, provider: AccountProviderId, state: string) {
  return client(cfg, provider).authorize(state);
}

/** OAuth callback: store encrypted tokens, then pull the last 14 days. */
export async function connectAccount(
  ctx: ServiceContext, actor: Actor, cfg: AccountsConfig, provider: AccountProviderId, code: string, verifier?: string, f: Fetch = fetch,
) {
  const c = client(cfg, provider);
  const t = await c.exchange(code, verifier, f);
  const existing = await getAccount(ctx, actor.id, provider);
  if (t.externalId) {
    // One provider account can back only one GoalFi user (no double entries in group challenges).
    const other = await ctx.db.connectedAccount.findFirst({ where: { provider, externalId: t.externalId, userId: { not: actor.id } } });
    if (other) throw conflict(`This ${PROVIDER_INFO[provider].name} account is already connected to another GoalFi user`);
  }
  const refresh = t.refreshToken ?? (existing?.refreshTokenEnc ? decryptToken(existing.refreshTokenEnc, cfg.tokenKey) : null);
  const data = {
    accessTokenEnc: encryptToken(t.accessToken, cfg.tokenKey),
    refreshTokenEnc: refresh ? encryptToken(refresh, cfg.tokenKey) : null,
    expiresAt: t.expiresAt, scope: t.scope, status: "ACTIVE", lastError: null, lastSyncAt: null,
    externalId: t.externalId, externalName: t.externalName,
  };
  await ctx.db.connectedAccount.upsert({
    where: { userId_provider: { userId: actor.id, provider } },
    update: data,
    create: { userId: actor.id, provider, ...data },
  });
  await audit(ctx.db, actor.id, "account.connected", "User", actor.id, { provider, externalName: t.externalName });
  const today = isoDay(ctx.now());
  await syncAccount(ctx, cfg, actor.id, provider, addDays(today, -13), addDays(today, 1), f, true).catch(() => undefined);
}

export async function disconnectAccount(ctx: ServiceContext, actor: Actor, cfg: AccountsConfig | null, provider: AccountProviderId, f: Fetch = fetch) {
  const a = await getAccount(ctx, actor.id, provider);
  if (!a) return;
  const c = cfg?.providers[provider];
  if (cfg && c) {
    try {
      await c.revoke(decryptToken(a.refreshTokenEnc ?? a.accessTokenEnc, cfg.tokenKey), f);
    } catch {
      // Best effort; the connection is removed either way.
    }
  }
  await ctx.db.$transaction([
    ctx.db.connectedAccount.delete({ where: { id: a.id } }),
    // Raw data is removed; evidence already used in challenges stays (it is the audit trail).
    ctx.db.activityDaily.deleteMany({ where: { userId: actor.id, provider } }),
    ctx.db.activityEvent.deleteMany({ where: { userId: actor.id, provider } }),
  ]);
  await audit(ctx.db, actor.id, "account.disconnected", "User", actor.id, { provider });
}

async function accessToken(ctx: ServiceContext, cfg: AccountsConfig, userId: string, provider: AccountProviderId, f: Fetch): Promise<string> {
  const a = await getAccount(ctx, userId, provider);
  if (!a || a.status === "REVOKED") throw new ProviderError("Not connected", 401, true);
  if (a.expiresAt.getTime() - ctx.now().getTime() > 60_000) return decryptToken(a.accessTokenEnc, cfg.tokenKey);
  const c = client(cfg, provider);
  if (!c.refresh || !a.refreshTokenEnc) throw new ProviderError(`${PROVIDER_INFO[provider].name} access expired: reconnect`, 401, true);
  const t = await c.refresh(decryptToken(a.refreshTokenEnc, cfg.tokenKey), f);
  await ctx.db.connectedAccount.update({
    where: { id: a.id },
    data: {
      accessTokenEnc: encryptToken(t.accessToken, cfg.tokenKey),
      expiresAt: t.expiresAt,
      ...(t.refreshToken ? { refreshTokenEnc: encryptToken(t.refreshToken, cfg.tokenKey) } : {}),
    },
  });
  return t.accessToken;
}

/** Pull data for local days [startIso, endIsoExclusive) and store it. Returns rows stored. */
export async function syncAccount(
  ctx: ServiceContext, cfg: AccountsConfig, userId: string, provider: AccountProviderId,
  startIso: string, endIsoExclusive: string, f: Fetch = fetch, force = false,
) {
  const a = await getAccount(ctx, userId, provider);
  if (!a || a.status === "REVOKED" || !cfg.providers[provider]) return 0;
  if (!force && a.lastSyncAt && ctx.now().getTime() - a.lastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS) return 0;
  try {
    const token = await accessToken(ctx, cfg, userId, provider, f);
    const data = await client(cfg, provider).fetch(token, a, startIso, endIsoExclusive, f);
    for (const r of data.daily) {
      const date = new Date(`${r.date}T00:00:00Z`);
      await ctx.db.activityDaily.upsert({
        where: { userId_provider_date_metric: { userId, provider, date, metric: r.metric } },
        update: { value: r.value, fetchedAt: ctx.now() },
        create: { userId, provider, date, metric: r.metric, value: r.value },
      });
    }
    for (const e of data.events) {
      await ctx.db.activityEvent.upsert({
        where: { userId_provider_metric_externalId: { userId, provider, metric: e.metric, externalId: e.externalId } },
        update: { occurredAt: e.occurredAt, value: e.value, groupKey: e.groupKey ?? null, fetchedAt: ctx.now() },
        create: { userId, provider, metric: e.metric, externalId: e.externalId, occurredAt: e.occurredAt, value: e.value, groupKey: e.groupKey ?? null },
      });
    }
    await ctx.db.connectedAccount.update({ where: { id: a.id }, data: { lastSyncAt: ctx.now(), status: "ACTIVE", lastError: null } });
    return data.daily.length + data.events.length;
  } catch (e) {
    const reconnect = e instanceof ProviderError && e.reconnect;
    await ctx.db.connectedAccount.update({
      where: { id: a.id },
      data: { lastSyncAt: ctx.now(), status: reconnect ? "ERROR" : a.status, lastError: (e as Error).message.slice(0, 300) },
    });
    if (reconnect)
      await notify(ctx.db, [userId], {
        type: "MARKET_UPDATE",
        message: `GoalFi lost access to your ${PROVIDER_INFO[provider].name} account. Reconnect in Settings so your progress keeps counting.`,
        link: link(ctx, "/settings#accounts"),
        dedupKey: `ACCOUNT_RECONNECT:${provider}:${userId}:${isoDay(ctx.now())}`,
      });
    return 0;
  }
}

/** Recent per-day values of a metric (oldest first), for history and suggestions. Event metrics are bucketed by UTC day. */
export async function recentDaily(ctx: ServiceContext, userId: string, metricId: string, days = 14) {
  const metric = appMetric(metricId);
  if (!metric) return [];
  const since = new Date(new Date(`${isoDay(ctx.now())}T00:00:00Z`).getTime() - (days - 1) * DAY);
  if (metric.source === "event") {
    const rows = await ctx.db.activityEvent.findMany({ where: { userId, metric: metric.id, occurredAt: { gte: since } } });
    const acct = metric.provider === "GOOGLE_HEALTH" || metric.provider === "GITHUB" || metric.provider === "LICHESS" ? await getAccount(ctx, userId, metric.provider) : null;
    if (!acct) return [];
    const by = new Map<string, number>();
    // Days since the account was connected with no events are real zeros.
    for (let t = Math.max(since.getTime(), new Date(`${isoDay(acct.createdAt)}T00:00:00Z`).getTime() - 13 * DAY); t <= ctx.now().getTime(); t += DAY) by.set(isoDay(new Date(t)), 0);
    for (const r of rows) by.set(isoDay(r.occurredAt), (by.get(isoDay(r.occurredAt)) ?? 0) + r.value);
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }
  const rows = await ctx.db.activityDaily.findMany({ where: { userId, metric: metric.id, date: { gte: since } }, orderBy: { date: "asc" } });
  return [...byDay(metric, rows)].map(([date, v]) => ({ date, value: v.value }));
}

/** One value per local day across sources: the best one counts, never the sum. */
function byDay(metric: AppMetricDef, rows: { date: Date; value: number; provider: string }[]): Map<string, { value: number; provider: string }> {
  const out = new Map<string, { value: number; provider: string }>();
  for (const r of rows) {
    const d = isoDay(r.date);
    const cur = out.get(d);
    if (!cur || combineDaily(metric, [cur.value, r.value]) !== cur.value) out.set(d, { value: r.value, provider: r.provider });
  }
  return out;
}

type ConnectedChallenge = Prisma.ChallengeGetPayload<{ include: { participants: true } }>;

const name = (p: string) => PROVIDER_INFO[p as keyof typeof PROVIDER_INFO]?.name ?? p;

function describe(metric: AppMetricDef, value: number, date: string, source: string): string {
  if (metric.id === "wake_time") return `Woke up at ${formatMetricValue(metric, value)} on ${date} (synced from ${name(source)})`;
  if (metric.source === "level") return `${formatMetricValue(metric, value)} ${metric.unit} on ${date} (counted by ${name(source)})`;
  return `${formatMetricValue(metric, value)} ${metric.unit} on ${date} (synced from ${name(source)})`;
}

/** Evidence is immutable: a changed value adds a row that supersedes the current one. */
async function upsertEvidence(
  ctx: ServiceContext, c: ConnectedChallenge, metric: AppMetricDef, participantId: string, userId: string,
  date: string, value: number, current: { id: string; progressValue: unknown } | null, source: string = metric.provider,
): Promise<number> {
  if (current && Number(current.progressValue) === value) return 0;
  const isNewDay = !current;
  await ctx.db.evidence.create({
    data: {
      challengeId: c.id, participantId, userId,
      description: describe(metric, value, date, source),
      links: [], progressValue: value, activityDate: new Date(`${date}T00:00:00Z`),
      contentHash: createHash("sha256").update(`${source}:${metric.id}:${userId}:${date}:${value}`).digest("hex"),
      status: "APPROVED", decidedAt: ctx.now(), autoDecision: CONNECTED_APP_DECISION,
      supersedesId: current?.id ?? null,
    },
  });
  // Synced days advance streaks in recurring challenges, like approved uploads do.
  if (isNewDay && metric.source !== "level" && c.recurrence !== "NONE")
    await applyStreak(ctx.db, { userId, challengeId: c.id, recurrence: c.recurrence, activityDate: new Date(`${date}T00:00:00Z`) });
  return 1;
}

/** Per-day values for one participant inside the challenge window: [local date, value, source]. */
async function windowValues(ctx: ServiceContext, c: ConnectedChallenge, metric: AppMetricDef, userId: string): Promise<[string, number, string][]> {
  if (metric.source === "daily") {
    const rows = await ctx.db.activityDaily.findMany({
      where: {
        userId, metric: metric.id,
        date: { gte: new Date(`${isoDay(new Date(c.startDate.getTime() - DAY))}T00:00:00Z`), lte: new Date(`${isoDay(new Date(c.endDate.getTime() + DAY))}T00:00:00Z`) },
      },
    });
    // Local days whose midday is inside the challenge window; one value per day across sources.
    return [...byDay(metric, rows.filter((d) => civilDayInWindow(isoDay(d.date), c.startDate, c.endDate)))].map(([d, v]) => [d, v.value, v.provider]);
  }
  // Events: challenge day k = [start + k·24h, start + (k+1)·24h). The builder starts app-verified
  // challenges at local midnight, so these are the participant's local days.
  const events = await ctx.db.activityEvent.findMany({ where: { userId, metric: metric.id, occurredAt: { gte: c.startDate, lt: c.endDate } } });
  const out = new Map<number, number>();
  const perGroup = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    const k = Math.floor((e.occurredAt.getTime() - c.startDate.getTime()) / DAY);
    if (e.groupKey) {
      // Anti-farming: only the first few events per opponent per day count.
      const g = `${k}:${e.groupKey}`;
      const n = (perGroup.get(g) ?? 0) + 1;
      perGroup.set(g, n);
      if (n > MAX_EVENTS_PER_OPPONENT_PER_DAY) continue;
    }
    out.set(k, (out.get(k) ?? 0) + e.value);
  }
  return [...out].map(([k, v]) => [isoDay(new Date(c.startDate.getTime() + k * DAY + 12 * 3_600_000)), v, metric.provider]);
}

/** Turn synced values into approved evidence for one participant. */
async function materialize(ctx: ServiceContext, c: ConnectedChallenge, metric: AppMetricDef, userId: string, participantId: string): Promise<number> {
  const rule = SuccessRuleSchema.parse(c.successRule);
  let created = 0;
  for (const [date, value, source] of await windowValues(ctx, c, metric, userId)) {
    const qualifies = rule.type === "daily_completion" ? meetsDailyTarget(metric, value, c.appDailyTarget ?? NaN) : value > 0;
    if (!qualifies) continue;
    const current = await ctx.db.evidence.findFirst({
      where: { challengeId: c.id, userId, activityDate: new Date(`${date}T00:00:00Z`), autoDecision: CONNECTED_APP_DECISION, supersededBy: null },
    });
    created += await upsertEvidence(ctx, c, metric, participantId, userId, date, value, current, source);
  }
  return created;
}

/** Community metrics: the current value, or null if it can't be measured right now. */
async function communityLevel(ctx: ServiceContext, cfg: AccountsConfig | null, metric: AppMetricDef, communityId: string | null, f: Fetch): Promise<number | null> {
  if (!communityId) return null;
  if (metric.id === "community_members") {
    // Only established members count, so a burst of fresh fake accounts doesn't move the number.
    const members = await ctx.db.communityMember.findMany({
      where: { communityId },
      select: { user: { select: { createdAt: true, walletAddress: true, telegramId: true, reputationScore: true } } },
    });
    return members.filter((m) => establishedMember(m.user, ctx.now(), trustDays(ctx))).length;
  }
  if (metric.id === "telegram_members") {
    const comm = await ctx.db.community.findUnique({ where: { id: communityId }, select: { telegramChatId: true } });
    if (!comm?.telegramChatId || !cfg?.telegram) return null;
    return telegramMemberCount(cfg.telegram.botToken, comm.telegramChatId, f, cfg.telegram.apiRoot);
  }
  return null;
}

/**
 * Community metrics have one subject (the community), recorded against the challenge creator's
 * participant row: a single live evidence row holding the latest count.
 */
async function materializeLevel(ctx: ServiceContext, c: ConnectedChallenge, metric: AppMetricDef, value: number): Promise<number> {
  const p = c.participants.find((x) => x.userId === c.creatorId)
    ?? (await ctx.db.participant.upsert({ where: { challengeId_userId: { challengeId: c.id, userId: c.creatorId } }, update: {}, create: { challengeId: c.id, userId: c.creatorId } }));
  const current = await ctx.db.evidence.findFirst({ where: { challengeId: c.id, userId: c.creatorId, autoDecision: CONNECTED_APP_DECISION, supersededBy: null } });
  return upsertEvidence(ctx, c, metric, p.id, c.creatorId, isoDay(ctx.now()), value, current, metric.provider);
}

/** Hours before a deadline when participants who are short get one reminder. */
export const SHORT_REMINDER_HOURS = 3;

/**
 * "Running out of time and you're short": one reminder per challenge (totals) or per challenge day
 * (daily goals), SHORT_REMINDER_HOURS before the deadline, with how much is left to go.
 */
async function shortReminder(ctx: ServiceContext, c: ConnectedChallenge, metric: AppMetricDef, userId: string): Promise<boolean> {
  if (metric.better !== "higher" || metric.source === "level") return false;
  const rule = SuccessRuleSchema.parse(c.successRule);
  const now = ctx.now().getTime();
  const fmt = (v: number) => formatMetricValue(metric, v);
  const values = await windowValues(ctx, c, metric, userId);
  let deadline: number, have: number, need: number, dedupKey: string, scope: string;
  if (rule.type === "individual_threshold") {
    deadline = c.endDate.getTime();
    have = values.reduce((a, [, v]) => a + v, 0);
    need = rule.threshold;
    dedupKey = `SHORT:${c.id}:${userId}`;
    scope = `in “${c.title}”`;
  } else if (rule.type === "daily_completion" && c.appDailyTarget) {
    const k = Math.floor((now - c.startDate.getTime()) / DAY);
    deadline = Math.min(c.startDate.getTime() + (k + 1) * DAY, c.endDate.getTime());
    const day = isoDay(new Date(c.startDate.getTime() + k * DAY + 12 * 3_600_000));
    have = values.find(([d]) => d === day)?.[1] ?? 0;
    need = c.appDailyTarget;
    dedupKey = `SHORT:${c.id}:${userId}:${k}`;
    scope = `today in “${c.title}”`;
  } else return false;
  const left = deadline - now;
  if (left <= 0 || left > SHORT_REMINDER_HOURS * 3_600_000 || have >= need) return false;
  const hours = Math.max(1, Math.round(left / 3_600_000));
  const sent = await notify(ctx.db, [userId], {
    type: "CHALLENGE_ENDING",
    message: `⏳ About ${hours}h left ${scope}: you’re at ${fmt(have)} of ${fmt(need)} ${metric.unit}, ${fmt(Math.max(0, need - have))} to go.`,
    link: link(ctx, `/challenges/${c.slug}`),
    dedupKey,
  });
  return sent > 0;
}

/**
 * Scheduler step: for app-verified and "watch or proof" challenges that are running (or ended less
 * than SYNC_GRACE_HOURS ago), sync each participant's accounts and update their evidence.
 */
export async function accountsTick(ctx: ServiceContext, cfg: AccountsConfig | null, f: Fetch = fetch) {
  const out = { challenges: 0, synced: 0, evidence: 0, notConnected: 0, reminders: 0 };
  const now = ctx.now();
  const challenges = await ctx.db.challenge.findMany({
    where: {
      verificationMethod: { in: ["CONNECTED_APP", "HYBRID"] },
      status: { in: ["ACTIVE", "IN_REVIEW"] },
      startDate: { lte: now },
      endDate: { gte: new Date(now.getTime() - SYNC_GRACE_HOURS * 3_600_000) },
    },
    include: { participants: { where: { status: { not: "WITHDRAWN" } } } },
  });
  out.challenges = challenges.length;
  const synced = new Set<string>();
  for (const c of challenges) {
    const metric = appMetric(c.appMetric);
    if (!metric) continue;
    if (metric.source === "level") {
      // A level is "at the end": stop measuring once the challenge is over.
      if (now >= c.endDate) continue;
      const v = await communityLevel(ctx, cfg, metric, c.communityId, f);
      if (v !== null) out.evidence += await materializeLevel(ctx, c, metric, v);
      continue;
    }
    if (!cfg) continue;
    const hybrid = c.verificationMethod === "HYBRID";
    for (const p of c.participants) {
      const ready = await readyAccounts(ctx, p.userId, metric);
      if (ready.length === 0) {
        out.notConnected++;
        await notify(ctx.db, [p.userId], {
          type: "MARKET_UPDATE",
          message: hybrid
            ? `“${c.title}”: connect ${metricSourceLabel(metric)} so your progress counts automatically, or upload proof on the challenge page.`
            : `Connect ${metricSourceLabel(metric)} so your progress counts in “${c.title}”.`,
          link: link(ctx, hybrid ? `/challenges/${c.slug}` : "/settings#accounts"),
          dedupKey: `CONNECT_ACCOUNT:${c.id}:${p.userId}`,
        });
        continue; // nothing to sync; with "watch or proof" their uploads are reviewed by verifiers
      }
      for (const a of ready) {
        const key = `${p.userId}:${a.provider}`;
        if (synced.has(key)) continue;
        synced.add(key);
        // The widest window this user needs (max 31 days back).
        const mine = challenges.filter((x) => x.participants.some((q) => q.userId === p.userId));
        const start = isoDay(new Date(Math.max(Math.min(...mine.map((x) => x.startDate.getTime())) - DAY, now.getTime() - 31 * DAY)));
        out.synced += await syncAccount(ctx, cfg, p.userId, a.provider, start, addDays(isoDay(now), 1), f);
      }
      out.evidence += await materialize(ctx, c, metric, p.userId, p.id);
      if (now < c.endDate && (await shortReminder(ctx, c, metric, p.userId))) out.reminders++;
    }
  }
  return out;
}

/** Human summary of how an app-verified challenge is measured. */
export function measuredBy(metricId: string | null, dailyTarget: number | null, sources?: Set<string>): string | null {
  const metric = appMetric(metricId);
  if (!metric) return null;
  const who = metric.source === "level" ? `counted by ${name(metric.provider)}` : `synced from each participant’s ${metricSourceLabel(metric, sources)} account`;
  return `${metric.label}, ${who}${dailyTarget ? ` (a day counts ${metric.better === "lower" ? "if you " : "at "}${describeDailyTarget(metric, dailyTarget)})` : ""}`;
}
