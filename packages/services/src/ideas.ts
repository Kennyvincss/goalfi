import { APP_METRICS, CHALLENGE_TEMPLATES, metricProviders, suggestChallenges, type AppMetricId, type AppSuggestion } from "@goalfi/core";
import type { AccountsConfig } from "./accounts/config";
import type { Fetch } from "./accounts/http";
import { telegramMemberCount } from "./accounts/telegram-count";
import { link, type ServiceContext } from "./context";

/** Metrics this server can measure (at least one of their sources is configured). */
export function availableMetrics(cfg: AccountsConfig | null): AppMetricId[] {
  const providers = new Set<string>([...Object.keys(cfg?.providers ?? {}), "GOALFI", ...(cfg?.telegram ? ["TELEGRAM"] : [])]);
  return (Object.keys(APP_METRICS) as AppMetricId[]).filter((id) => metricProviders(APP_METRICS[id]).some((p) => providers.has(p)));
}

/** Group ideas for a community: growth goals plus group versions of every metric this server can verify. */
export function communitySuggestions(c: { name: string; memberCount: number; telegramMembers: number | null }, metrics: AppMetricId[]): AppSuggestion[] {
  const out: AppSuggestion[] = [...suggestChallenges("community_members", [], { name: c.name, memberCount: c.memberCount, currentLevel: c.memberCount })];
  if (c.telegramMembers !== null && metrics.includes("telegram_members"))
    out.push(...suggestChallenges("telegram_members", [], { name: c.name, memberCount: c.memberCount, currentLevel: c.telegramMembers }));
  // Group activity ideas are sized by the bigger audience: GoalFi members or the Telegram group.
  const audience = Math.max(c.memberCount, c.telegramMembers ?? 0);
  for (const id of metrics) {
    if (APP_METRICS[id].source === "level") continue;
    out.push(...suggestChallenges(id, [], { name: c.name, memberCount: audience }).filter((s) => s.scope === "group"));
  }
  return out;
}

/** ISO week key, e.g. "2026-W48". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface IdeaPick {
  title: string;
  note: string;
  url: string;
}

/**
 * Three ideas for a community, rotating every week: a growth goal, a group activity the server
 * can verify automatically, and a task anyone can do (human-verified).
 */
export function weeklyPicks(ctx: ServiceContext, c: { id: string; name: string; memberCount: number; telegramMembers: number | null }, metrics: AppMetricId[], week: string): IdeaPick[] {
  const n = Number(week.slice(-2)) + Number(week.slice(0, 4));
  const all = communitySuggestions(c, metrics);
  const create = (s: AppSuggestion) => link(ctx, `/challenges/new?${new URLSearchParams({ suggest: s.id, community: c.id })}`);
  const picks: IdeaPick[] = [];
  const growth = all.filter((s) => s.metric === "community_members");
  if (growth.length) {
    const s = growth[n % growth.length]!;
    picks.push({ title: s.title, note: "counted by GoalFi", url: create(s) });
  }
  const activity = all.filter((s) => APP_METRICS[s.metric].source !== "level" && (s.id.endsWith(":group-today") || s.id.endsWith(":group-week-total")));
  if (activity.length) {
    const s = activity[n % activity.length]!;
    picks.push({ title: s.title, note: "verifies itself from connected apps", url: create(s) });
  }
  const tasks = CHALLENGE_TEMPLATES.filter((t) => ["fitness", "lifestyle", "community", "education"].includes(t.category));
  const t = tasks[n % tasks.length]!;
  picks.push({ title: t.title, note: "checked by verifiers", url: link(ctx, `/challenges/new?template=${encodeURIComponent(t.id)}`) });
  return picks;
}

export function ideasText(communityName: string, picks: IdeaPick[]): string {
  return [
    `💡 Challenge ideas for ${communityName} this week:`,
    "",
    ...picks.map((p, i) => `${i + 1}. ${p.title} (${p.note})`),
    "",
    "Community admins can launch one with a tap. Each comes with its own prediction market.",
  ].join("\n");
}

/** Once a week (from Monday 10:00 UTC), post three ideas to each community's Telegram group. */
export async function weeklyIdeasTick(ctx: ServiceContext, cfg: AccountsConfig | null, f: Fetch = fetch): Promise<number> {
  const now = ctx.now();
  const day = now.getUTCDay() || 7;
  if (day === 1 && now.getUTCHours() < 10) return 0;
  const week = isoWeek(now);
  const metrics = availableMetrics(cfg);
  const communities = await ctx.db.community.findMany({
    where: { telegramChatId: { not: null }, weeklyIdeas: true },
    select: { id: true, name: true, telegramChatId: true, _count: { select: { members: true } } },
  });
  let posted = 0;
  for (const c of communities) {
    const dedupKey = `IDEAS:${c.id}:${week}`;
    if (await ctx.db.telegramOutbox.findUnique({ where: { dedupKey } })) continue;
    const telegramMembers = cfg?.telegram ? await telegramMemberCount(cfg.telegram.botToken, c.telegramChatId!, f, cfg.telegram.apiRoot) : null;
    const picks = weeklyPicks(ctx, { id: c.id, name: c.name, memberCount: c._count.members, telegramMembers }, metrics, week);
    await ctx.db.telegramOutbox.create({
      data: {
        chatId: c.telegramChatId!, dedupKey, text: ideasText(c.name, picks),
        buttons: [...picks.map((p, i) => ({ text: `▶ Create idea ${i + 1}`, url: p.url })), { text: "More ideas", url: link(ctx, "/ideas?tab=groups") }],
      },
    });
    posted++;
  }
  return posted;
}
