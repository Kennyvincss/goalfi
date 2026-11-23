import { redirect } from "next/navigation";
import { CHALLENGE_TEMPLATES, suggestStepChallenges } from "@goalfi/core";
import { getFitnessConnection, recentDailySteps } from "@goalfi/services";
import { fitnessConfig } from "@/lib/server/fitness";
import { prisma } from "@goalfi/db";
import { getCurrentUser } from "@/lib/server/auth";
import { services } from "@/lib/server/services";
import { ChallengeBuilder } from "./builder";

export const metadata = { title: "Create a challenge" };
export const dynamic = "force-dynamic";

export default async function NewChallenge({ searchParams }: { searchParams: Promise<{ suggest?: string; community?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/challenges/new");
  const [categories, communities] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
    prisma.community.findMany({
      where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
  ]);
  const ctx = services();
  const conn = await getFitnessConnection(ctx, user.id);
  const { suggest, community } = await searchParams;
  let suggestion = null;
  if (suggest) {
    const today = new Date().toISOString().slice(0, 10);
    const history = (await recentDailySteps(ctx, user.id, 14)).filter((d) => d.date !== today).map((d) => d.value);
    const c = communities.find((x) => x.id === community);
    const s = suggestStepChallenges(history, c ? { name: c.name, memberCount: c._count.members } : undefined).find((x) => x.id === suggest);
    if (s) suggestion = { ...s, communityId: s.scope === "group" ? c?.id : undefined };
  }
  const gw = ctx.gateway;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Create a challenge</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">Start from a template; every field is editable. You’ll review a full summary and confirm the rules before anything goes live.</p>
      <div className="mt-8">
        <ChallengeBuilder
          templates={CHALLENGE_TEMPLATES}
          categories={categories}
          communities={communities.map((c) => ({ id: c.id, name: c.name }))}
          fitness={{ available: !!fitnessConfig(), connected: conn?.status === "ACTIVE" }}
          suggestion={suggestion}
          collateralSymbol={gw?.collateralSymbol ?? "USDC"}
          marketsAvailable={!!gw}
        />
      </div>
    </div>
  );
}
