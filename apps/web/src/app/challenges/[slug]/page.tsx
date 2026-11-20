import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ExternalLink, Scale, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@goalfi/db";
import { explorerAccountUrl, chainConfigFromEnv } from "@goalfi/chain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryIcon } from "@/components/category-icon";
import { ProbabilityBar } from "@/components/challenge-card";
import { getCurrentUser } from "@/lib/server/auth";
import { visibleChallengesWhere } from "@/lib/server/queries";
import { timeRemaining } from "@/lib/utils";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ChallengePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getCurrentUser();
  const c = await prisma.challenge.findFirst({
    where: { AND: [{ slug }, visibleChallengesWhere(viewer?.id ?? null)] },
    include: {
      category: true,
      community: { select: { slug: true, name: true } },
      creator: { select: { username: true, displayName: true } },
      roles: { select: { role: true, user: { select: { username: true } } } },
      _count: { select: { participants: true } },
      market: { include: { snapshots: { orderBy: { takenAt: "desc" }, take: 1 }, outcomes: { orderBy: { index: "asc" } } } },
    },
  });
  if (!c) notFound();
  const verifiers = c.roles.filter((r) => r.role === "VERIFIER");
  const snap = c.market?.snapshots[0];
  const cfg = (() => { try { return chainConfigFromEnv(); } catch { return null; } })();
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CategoryIcon icon={c.category.icon} className="size-4" />{c.category.name}
            {c.community && <>· <Link href={`/communities/${c.community.slug}`} className="hover:text-foreground">{c.community.name}</Link></>}
            <Badge variant="outline">{c.status.replaceAll("_", " ").toLowerCase()}</Badge>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{c.title}</h1>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{c.description}</p>
          <p className="mt-2 text-sm text-muted-foreground">Created by <Link className="hover:text-foreground" href={`/profile/${c.creator.username}`}>@{c.creator.username}</Link></p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" />{fmt(c.startDate)} → {fmt(c.endDate)} · {timeRemaining(c.endDate)}</span>
          <span className="flex items-center gap-1.5"><Users className="size-4 text-muted-foreground" />{c._count.participants} participants</span>
        </div>
        <Card><CardHeader><CardTitle>Success criteria</CardTitle></CardHeader><CardContent className="whitespace-pre-line text-sm">{c.successCriteria}</CardContent></Card>
        <Card><CardHeader><CardTitle>Rules</CardTitle></CardHeader><CardContent className="whitespace-pre-line text-sm">{c.rules}</CardContent></Card>
        <Card><CardHeader><CardTitle>Evidence</CardTitle></CardHeader><CardContent className="whitespace-pre-line text-sm">{c.evidenceReq}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Verification & disputes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />{c.requiredApprovals} of {verifiers.length || "?"} verifiers must approve each submission</p>
            <p className="flex items-center gap-2"><Scale className="size-4 text-primary" />{c.disputeWindowHours}h dispute window after each decision</p>
            {verifiers.length > 0 && <p className="text-muted-foreground">Verifiers: {verifiers.map((v) => `@${v.user.username}`).join(", ")}</p>}
          </CardContent>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Prediction market</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!c.market ? <p className="text-muted-foreground">This challenge has no market.</p> : (
              <>
                {snap && Number.isFinite(snap.yesPrice) ? <ProbabilityBar yes={snap.yesPrice} /> : <p className="text-muted-foreground">Awaiting liquidity.</p>}
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{c.market.status.replaceAll("_", " ").toLowerCase()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trading closes</span><span>{fmt(c.market.endTs)}</span></div>
                {c.market.marketAddress && cfg && (
                  <a className="flex items-center gap-1 text-primary" href={explorerAccountUrl(cfg, c.market.marketAddress)} target="_blank" rel="noreferrer">
                    View on-chain market <ExternalLink className="size-3.5" />
                  </a>
                )}
                {snap && <p className="text-xs text-muted-foreground">Price indexed {snap.takenAt.toLocaleString()}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
