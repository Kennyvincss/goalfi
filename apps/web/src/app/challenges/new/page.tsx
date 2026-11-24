import { redirect } from "next/navigation";
import { ACCOUNT_PROVIDERS, APP_METRICS, CHALLENGE_TEMPLATES, marketLimits, suggestChallenges, type AppMetricId } from "@goalfi/core";
import { listAccounts, recentDaily, telegramMemberCount } from "@goalfi/services";
import { accountsConfig } from "@/lib/server/accounts";
import { topPicks } from "@/lib/server/ideas";
import { prisma } from "@goalfi/db";
import { getCurrentUser } from "@/lib/server/auth";
import { services } from "@/lib/server/services";
import { ChallengeBuilder } from "./builder";

export const metadata = { title: "Create a challenge" };
export const dynamic = "force-dynamic";

export default async function NewChallenge({ searchParams }: { searchParams: Promise<{ suggest?: string; community?: string; template?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/challenges/new");
  const [categories, communities] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
    prisma.community.findMany({
      where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } },
      select: { id: true, name: true, telegramChatId: true, _count: { select: { members: true } } },
    }),
  ]);
  const ctx = services();
  const cfg = accountsConfig();
  const accounts = await listAccounts(ctx, user.id);
  const apps: Record<string, { available: boolean; connected: boolean }> = {
    GOALFI: { available: true, connected: true },
    TELEGRAM: { available: !!cfg?.telegram, connected: true },
  };
  for (const p of ACCOUNT_PROVIDERS) apps[p] = { available: !!cfg?.providers[p], connected: accounts.some((a) => a.provider === p && a.status === "ACTIVE") };
  const { suggest, community, template } = await searchParams;
  const picks = suggest || template ? [] : await topPicks(user.id);
  let suggestion = null;
  const [metricId] = (suggest ?? "").split(":") as [AppMetricId];
  if (suggest && metricId in APP_METRICS) {
    const today = new Date().toISOString().slice(0, 10);
    const history = (await recentDaily(ctx, user.id, metricId, 14)).filter((d) => d.date !== today).map((d) => d.value);
    const c = communities.find((x) => x.id === community);
    const level = !c ? undefined
      : metricId === "community_members" ? c._count.members
      : metricId === "telegram_members" && c.telegramChatId && cfg?.telegram ? ((await telegramMemberCount(cfg.telegram.botToken, c.telegramChatId, fetch, cfg.telegram.apiRoot)) ?? undefined)
      : undefined;
    const s = suggestChallenges(metricId, history, c ? { name: c.name, memberCount: c._count.members, currentLevel: level } : undefined).find((x) => x.id === suggest);
    if (s) suggestion = { ...s, communityId: s.scope === "group" ? c?.id : undefined };
  }
  const gw = ctx.gateway;
  // Opening-liquidity limits for this creator (platform admins have none).
  const liquidityCaps = user.role === "PLATFORM_ADMIN" ? null : {
    standard: marketLimits({ easyToGame: false, creatorReputation: user.reputationScore, trustedParticipants: 0 }).maxInitialLiquidityUsdc,
    easy: marketLimits({ easyToGame: true, creatorReputation: user.reputationScore, trustedParticipants: 0 }).maxInitialLiquidityUsdc,
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Create a challenge</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">Start from a template; every field is editable. You’ll review a full summary and confirm the rules before anything goes live.</p>
      <div className="mt-8">
        <ChallengeBuilder
          templates={CHALLENGE_TEMPLATES}
          categories={categories}
          communities={communities.map((c) => ({ id: c.id, name: c.name }))}
          apps={apps}
          liquidityCaps={liquidityCaps}
          initialTemplateId={template ?? null}
          picks={picks}
          suggestion={suggestion}
          collateralSymbol={gw?.collateralSymbol ?? "USDC"}
          marketsAvailable={!!gw}
        />
      </div>
    </div>
  );
}
