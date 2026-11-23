import { redirect } from "next/navigation";
import { CHALLENGE_TEMPLATES } from "@goalfi/core";
import { prisma } from "@goalfi/db";
import { getCurrentUser } from "@/lib/server/auth";
import { services } from "@/lib/server/services";
import { ChallengeBuilder } from "./builder";

export const metadata = { title: "Create a challenge" };
export const dynamic = "force-dynamic";

export default async function NewChallenge() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/challenges/new");
  const [categories, communities] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
    prisma.community.findMany({ where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } }, select: { id: true, name: true } }),
  ]);
  const gw = services().gateway;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Create a challenge</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">Start from a template; every field is editable. You’ll review a full summary and confirm the rules before anything goes live.</p>
      <div className="mt-8">
        <ChallengeBuilder
          templates={CHALLENGE_TEMPLATES}
          categories={categories}
          communities={communities}
          collateralSymbol={gw?.collateralSymbol ?? "USDC"}
          marketsAvailable={!!gw}
        />
      </div>
    </div>
  );
}
