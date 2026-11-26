import "server-only";
import { APP_METRICS, metricProviders, suggestChallenges, type AppMetricId, type AppSuggestion } from "@goalfi/core";
import { prisma } from "@goalfi/db";
import { listAccounts, recentDaily, telegramMemberCount } from "@goalfi/services";
import { accountsConfig } from "./accounts";
import { services } from "./services";

const today = () => new Date().toISOString().slice(0, 10);

/** Metrics the user can be measured on: their active connected accounts. */
export async function connectedMetrics(userId: string): Promise<AppMetricId[]> {
  const active = new Set((await listAccounts(services(), userId)).filter((a) => a.status === "ACTIVE").map((a) => a.provider as string));
  return (Object.keys(APP_METRICS) as AppMetricId[]).filter((id) => metricProviders(APP_METRICS[id]).some((p) => active.has(p)));
}

/** Completed-day history (oldest first) for one metric. Today is excluded because it's still in progress. */
export async function history(userId: string, metric: AppMetricId): Promise<number[]> {
  return (await recentDaily(services(), userId, metric, 14)).filter((d) => d.date !== today()).map((d) => d.value);
}

/** Every personal suggestion for every connected metric, grouped by metric. */
export async function personalIdeas(userId: string): Promise<{ metric: AppMetricId; days: number; ideas: AppSuggestion[] }[]> {
  const metrics = await connectedMetrics(userId);
  return Promise.all(metrics.map(async (metric) => {
    const h = await history(userId, metric);
    return { metric, days: h.length, ideas: suggestChallenges(metric, h).filter((s) => s.scope === "personal") };
  }));
}

/** A short mixed list for the builder: one medium idea per connected metric, then easy ones. */
export async function topPicks(userId: string, n = 6): Promise<AppSuggestion[]> {
  const groups = await personalIdeas(userId);
  const by = (d: AppSuggestion["difficulty"]) => groups.flatMap((g) => g.ideas.filter((s) => s.difficulty === d).slice(0, 1));
  return [...by("medium"), ...by("easy"), ...by("hard")].slice(0, n);
}

/** Communities the user runs, with what's needed for group and growth ideas. */
export async function adminCommunities(userId: string) {
  const cfg = accountsConfig();
  const rows = await prisma.community.findMany({
    where: { members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } },
    select: { id: true, name: true, telegramChatId: true, _count: { select: { members: true } } },
  });
  return Promise.all(rows.map(async (c) => ({
    id: c.id, name: c.name, memberCount: c._count.members,
    telegramMembers: c.telegramChatId && cfg?.telegram ? await telegramMemberCount(cfg.telegram.botToken, c.telegramChatId, fetch, cfg.telegram.apiRoot) : null,
  })));
}
