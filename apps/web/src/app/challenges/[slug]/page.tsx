import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CalendarDays, ExternalLink, Scale, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@goalfi/db";
import { appMetric, metricProviders, metricSourceLabel, usesAppMetric, displayStatus, easyToGameReason, evaluateSuccessRule, formatUsd, progressFraction, PROVIDER_INFO, reviewDeadline, SuccessRuleSchema, type AccountProviderId } from "@goalfi/core";
import { readyAccounts, challengeAccess, participantPositions, listEvidence, measuredBy, providerSlug, resolutionReport } from "@goalfi/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CategoryIcon } from "@/components/category-icon";
import { ProbabilityBar } from "@/components/challenge-card";
import { getCurrentUser } from "@/lib/server/auth";
import { actorOf, services } from "@/lib/server/services";
import { toEvidenceItem } from "@/lib/server/evidence-view";
import { cn, timeRemaining } from "@/lib/utils";
import { ConfirmPanel } from "./_panels/confirm-panel";
import { MarketSetupPanel } from "./_panels/market-setup-panel";
import { JoinButton } from "./_panels/join-button";
import { EvidenceForm } from "./_panels/evidence-form";
import { StartNowPanel } from "./_panels/start-now";
import { accountsConfig } from "@/lib/server/accounts";
import { EvidenceList } from "./_panels/evidence-list";
import { ResolutionPanel } from "./_panels/resolution-panel";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await prisma.challenge.findUnique({ where: { slug: (await params).slug }, select: { title: true, visibility: true, status: true } });
  return { title: c && c.visibility === "PUBLIC" && c.status !== "DRAFT" ? c.title : "Challenge" };
}

export default async function ChallengePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const actor = user ? actorOf(user) : null;
  const ctx = services();
  const row = await prisma.challenge.findUnique({ where: { slug }, select: { id: true } });
  if (!row) notFound();
  const access = await challengeAccess(ctx.db, row.id, actor);
  if (!access.canView) notFound();

  const c = await prisma.challenge.findUniqueOrThrow({
    where: { id: row.id },
    include: {
      category: true,
      community: { select: { slug: true, name: true } },
      creator: { select: { username: true } },
      roles: { select: { role: true, user: { select: { username: true } } } },
      participants: { where: { status: { not: "WITHDRAWN" } }, select: { userId: true, status: true, betAgainstAt: true, user: { select: { username: true } } } },
      market: { include: { snapshots: { orderBy: { takenAt: "desc" }, take: 1 } } },
    },
  });
  const rule = SuccessRuleSchema.parse(c.successRule);
  const evidenceRows = await listEvidence(ctx, actor, c.id);
  const evidence = evidenceRows.map(toEvidenceItem);
  const approvedByUser = c.participants.map((p) => ({
    userId: p.userId,
    approved: evidenceRows.filter((e) => e.userId === p.userId && e.status === "APPROVED" && !e.supersededBy)
      .map((e) => ({ progressValue: e.progressValue ? Number(e.progressValue) : null, activityDate: e.activityDate?.toISOString().slice(0, 10) ?? null })),
  }));
  const live = evaluateSuccessRule(rule, approvedByUser);
  const verifiers = c.roles.filter((r) => r.role === "VERIFIER");
  // app: progress comes from a connected metric; hybrid ("watch or proof"): uploads are accepted too.
  const app = usesAppMetric(c.verificationMethod);
  const hybrid = c.verificationMethod === "HYBRID";
  const metric = app ? appMetric(c.appMetric) : null;
  const personal = !!metric && metric.source !== "level";
  const providerName = metric ? metricSourceLabel(metric) : "";
  const configured = accountsConfig()?.providers ?? {};
  const sources = metric ? metricProviders(metric).filter((p): p is AccountProviderId => p in configured) : [];
  const ready = personal && user ? await readyAccounts(ctx, user.id, metric!) : [];
  const acctReady = ready.length > 0;
  const acct = personal && user && sources.length ? await prisma.connectedAccount.findFirst({ where: { userId: user.id, provider: { in: sources } } }) : null;
  const readyNames = ready.map((a) => PROVIDER_INFO[a.provider as AccountProviderId].name).join(" and ");
  const lastSync = ready.map((a) => a.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const easyToGame = easyToGameReason(c);
  const positions = c.market ? await participantPositions(ctx, c.id) : new Map<string, { yes: bigint; no: bigint }>();
  const flagged = c.participants.filter((p) => p.betAgainstAt);
  const connectLinks = sources.map((p) => ({ name: PROVIDER_INFO[p].name, href: `/api/accounts/${providerSlug(p)}/connect?next=${encodeURIComponent(`/challenges/${c.slug}`)}` }));
  const joined = !!user && c.participants.some((p) => p.userId === user.id);
  const m = c.market;
  const snap = m?.snapshots[0];
  const gw = ctx.gateway;
  const now = new Date();
  const ended = now >= c.endDate;
  const showResolution = access.isAdmin && ended && ["ACTIVE", "IN_REVIEW", "UPCOMING"].includes(c.status);
  const report = showResolution && actor ? await resolutionReport(ctx, actor, c.id) : null;
  // "Watch or proof" daily goals: uploads state the day's amount, which must reach the daily target.
  const unit = "unit" in rule ? rule.unit : hybrid && metric ? metric.unit : null;
  const myReplaceable = user ? evidence.filter((e) => e.userId === user.id && !e.superseded && (e.status === "PENDING" || e.status === "REJECTED")) : [];
  const openDisputes = evidence.reduce((n, e) => n + e.disputes.filter((d) => d.status === "OPEN").length, 0);
  const pendingReviews = evidence.filter((e) => !e.superseded && (e.status === "PENDING" || e.status === "UNDER_REVIEW")).length;

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {c.status === "DRAFT" && access.isCreator && <ConfirmPanel challengeId={c.id} hasMarket={c.marketEnabled} />}
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CategoryIcon icon={c.category.icon} className="size-4" />{c.category.name}
            {c.community && <>· <Link href={`/communities/${c.community.slug}`} className="hover:text-foreground">{c.community.name}</Link></>}
            <Badge variant="outline">{displayStatus(c.status, c.startDate).replaceAll("_", " ").toLowerCase()}</Badge>
            {c.visibility !== "PUBLIC" && <Badge variant="muted">{c.visibility.toLowerCase()}</Badge>}
            {c.recurrence !== "NONE" && <Badge variant="muted">{c.recurrence.toLowerCase()}</Badge>}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{c.title}</h1>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{c.description}</p>
          <p className="mt-2 text-sm text-muted-foreground">Created by <Link className="hover:text-foreground" href={`/profile/${c.creator.username}`}>@{c.creator.username}</Link></p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" />{fmt(c.startDate)} → {fmt(c.endDate)} · {timeRemaining(c.endDate)}</span>
          <span className="flex items-center gap-1.5"><Users className="size-4 text-muted-foreground" />{c.participants.length} participants</span>
        </div>
        {c.status !== "DRAFT" && (
          <Card>
            <CardHeader><CardTitle>Verified progress</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Progress value={progressFraction(live)} tone="yes" />
              <p className="text-sm text-muted-foreground">{live.explanation} ({app ? (metric?.source === "level" ? `counted by ${providerName}` : `synced from ${providerName}`) : "approved evidence only"})</p>
            </CardContent>
          </Card>
        )}
        <Card><CardHeader><CardTitle>Success criteria</CardTitle></CardHeader><CardContent className="whitespace-pre-line text-sm">{c.successCriteria}</CardContent></Card>
        <Card><CardHeader><CardTitle>Rules</CardTitle></CardHeader><CardContent className="whitespace-pre-line text-sm">{c.rules}{c.participationReq && <p className="mt-3 text-muted-foreground">Participation: {c.participationReq}</p>}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Verification & disputes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {app && (
              <p className="flex items-center gap-2"><Activity className="size-4 shrink-0 text-primary" />{hybrid ? "Watch or proof" : "Verified automatically"}: {measuredBy(c.appMetric, c.appDailyTarget)}.{personal ? " Data that syncs up to 2 hours after the end still counts." : ""}</p>
            )}
            {hybrid && <p className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0 text-primary" />No connected account? Upload proof instead: {c.requiredApprovals} of {verifiers.length} verifiers must approve it.</p>}
            {!app && (
              <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />{c.requiredApprovals} of {verifiers.length} verifiers must approve each submission</p>
            )}
            <p className="flex items-center gap-2"><Scale className="size-4 text-primary" />{c.disputeWindowHours}h dispute window after each decision</p>
            {c.reviewDeadlineHours && (
              <p className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" />Review deadline {reviewDeadline(c.endDate, c.reviewDeadlineHours)!.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: evidence not approved by then counts as rejected</p>
            )}
            <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />{c.autoSettle ? (app ? "Settles automatically once late data has synced and the dispute window has passed" : "Settles automatically once everything is reviewed and the dispute window has passed") : "An administrator confirms the result after review"}</p>
            {metric?.provider === "GOOGLE_HEALTH" && <p className="text-muted-foreground">Only data recorded by a watch, ring or tracker counts. Anything typed in by hand, and edited sleep, doesn’t. If several of your devices record the same day, the higher value counts (never both).</p>}
            {metric?.provider === "LICHESS" && <p className="text-muted-foreground">Games shorter than 5 moves each don’t count, and at most 3 games a day against the same opponent count.</p>}
            {easyToGame && <p className="rounded-md bg-warning/10 px-3 py-2 text-warning"><b>Easier to game.</b> {easyToGame}</p>}
            {m && (
              <p className="flex items-start gap-2"><Scale className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Fair play: participants and the creator can only bet YES. Anyone found holding NO on their own challenge is flagged below, and loses 50 reputation if they don’t complete it.{flagged.length > 0 && <b className="text-no"> {flagged.length} participant{flagged.length === 1 ? " has" : "s have"} bet against themselves.</b>}</span>
              </p>
            )}
            <p className="text-muted-foreground">Evidence: {c.evidenceReq}</p>
            {verifiers.length > 0 && <p className="text-muted-foreground">Verifiers: {verifiers.map((v) => `@${v.user.username}`).join(", ")}</p>}
          </CardContent>
        </Card>
        {c.status !== "DRAFT" && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Evidence</CardTitle>
              {(access.isVerifier || access.isAdmin) && (
                <Button asChild size="sm" variant="outline"><Link href={`/challenges/${c.slug}/review`}>Review queue{pendingReviews + openDisputes > 0 ? ` (${pendingReviews + openDisputes})` : ""}</Link></Button>
              )}
            </CardHeader>
            <CardContent>
              <EvidenceList items={evidence} viewerId={user?.id ?? null} participantIds={c.participants.map((p) => p.userId)} disputeWindowHours={c.disputeWindowHours} unit={unit} mode="public" />
              {!access.isAdmin && !access.isVerifier && <p className="mt-3 text-xs text-muted-foreground">Only approved submissions (and your own) are shown publicly.</p>}
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="space-y-4">
        {m && (m.status === "CREATING" || m.status === "AWAITING_LIQUIDITY") && gw && (
          <MarketSetupPanel
            challengeId={c.id} marketId={m.id} status={m.status} lastError={m.lastError} marketAddress={m.marketAddress}
            authority={m.authority} programId={m.programId} collateralMint={m.collateralMint} collateralSymbol={gw.collateralSymbol}
            fundedMicro={m.fundedAmount.toString()} targetMicro={m.liquidityTargetUsdc.toString()}
            canManage={access.isAdmin} isCreator={access.isCreator} linkedWallet={user?.walletAddress ?? null}
          />
        )}
        {report && <ResolutionPanel challengeId={c.id} autoSettle={c.autoSettle} report={report} hasMarket={!!m && !["CREATING", "FAILED"].includes(m.status)} isPlatformAdmin={user?.role === "PLATFORM_ADMIN"} />}
        {c.status === "UPCOMING" && c.startDate > now && access.isAdmin && <StartNowPanel challengeId={c.id} startsAt={c.startDate.toISOString()} />}
        {["UPCOMING", "ACTIVE"].includes(c.status) && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              {personal && !hybrid && user && !joined && !acctReady ? (
                <>
                  <p className="text-sm">This challenge is verified from <b>{providerName}</b>. Connect an account to join{metric?.id === "wake_time" ? " (allow sleep access)" : ""}; your progress then counts automatically.</p>
                  {connectLinks.map((l) => <Button key={l.href} asChild className="w-full"><a href={l.href}><Activity />{acct ? `Reconnect ${l.name}` : `Connect ${l.name}`}</a></Button>)}
                </>
              ) : (
                <JoinButton challengeId={c.id} slug={c.slug} joined={joined} signedIn={!!user} />
              )}
              {hybrid && !joined && <p className="text-xs text-muted-foreground">Anyone can join: with a connected {providerName} account your progress counts automatically; otherwise you upload proof.</p>}
              <p className="text-xs text-muted-foreground">No wallet needed to participate.{personal ? ` Your daily ${metric!.label.toLowerCase()} are shown to other participants as evidence.` : ""}</p>
            </CardContent>
          </Card>
        )}
        {personal && joined && ["ACTIVE", "IN_REVIEW"].includes(c.status) && (
          <Card>
            <CardHeader><CardTitle>Your {metric!.label.toLowerCase()}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {acctReady ? (
                <p>Syncing automatically from {readyNames}{lastSync ? `, last checked ${lastSync.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}. Nothing to upload.</p>
              ) : hybrid ? (
                <>
                  <p>Upload proof below for each day or result. Or connect {providerName} and it counts automatically from then on.</p>
                  <div className="flex flex-wrap gap-2">{connectLinks.map((l) => <Button key={l.href} asChild size="sm" variant="outline"><a href={l.href}>Connect {l.name}</a></Button>)}</div>
                </>
              ) : (
                <>
                  <p className="text-no">GoalFi can’t read your {providerName} data right now, so it won’t count until you reconnect.</p>
                  <div className="flex flex-wrap gap-2">{connectLinks.map((l) => <Button key={l.href} asChild size="sm"><a href={l.href}>Reconnect {l.name}</a></Button>)}</div>
                </>
              )}
            </CardContent>
          </Card>
        )}
        {(!app || (hybrid && !acctReady)) && joined && ["ACTIVE", "IN_REVIEW"].includes(c.status) && now.getTime() <= c.endDate.getTime() + 24 * 3_600_000 && (
          <Card>
            <CardHeader><CardTitle>Submit evidence</CardTitle></CardHeader>
            <CardContent>
              <EvidenceForm challengeId={c.id} unit={unit} needsDate={rule.type === "daily_completion" || c.recurrence !== "NONE"} replaceable={myReplaceable.map((e) => ({ id: e.id, label: `${e.submittedAt.slice(0, 10)}: ${e.description.slice(0, 40)}` }))} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Prediction market</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!m ? <p className="text-muted-foreground">This challenge has no market.</p> : (
              <>
                {c.marketQuestion && <p className="font-medium">{c.marketQuestion}</p>}
                {snap && Number.isFinite(snap.yesPrice) ? <ProbabilityBar yes={snap.yesPrice} /> : <p className="text-muted-foreground">{m.status === "RESOLVED" ? "Resolved." : "Awaiting liquidity."}</p>}
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{m.status.replaceAll("_", " ").toLowerCase()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Trading closes</span><span>{fmt(m.endTs)}</span></div>
                {m.liquidity > 0n && <div className="flex justify-between"><span className="text-muted-foreground">Pool value</span><span className="tabular">{formatUsd(m.liquidity)} {gw?.collateralSymbol ?? "USDC"}</span></div>}
                {m.status === "RESOLVED" && m.winningOutcome && <div className="flex justify-between"><span className="text-muted-foreground">Winning outcome</span><b className={m.winningOutcome === 1 ? "text-yes" : "text-no"}>{m.winningOutcome === 1 ? "YES" : "NO"}</b></div>}
                {m.marketAddress && m.status !== "CREATING" && (
                  <a className="flex items-center gap-1 text-primary" href={`https://solscan.io/account/${m.marketAddress}${m.cluster === "DEVNET" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">
                    View on-chain market <ExternalLink className="size-3.5" />
                  </a>
                )}
                {m.resolutionSignature && gw && <a className="flex items-center gap-1 text-primary" href={gw.explorerTxUrl(m.resolutionSignature)} target="_blank" rel="noreferrer">Resolution transaction <ExternalLink className="size-3.5" /></a>}
                {snap && <p className="text-xs text-muted-foreground">Price indexed {snap.takenAt.toLocaleString()}</p>}
                {["OPEN", "CLOSED", "RESOLVING", "RESOLVED"].includes(m.status) && (
                  <Button asChild className="w-full"><Link href={`/markets/${c.slug}`}>{m.status === "OPEN" ? "Trade this market" : m.status === "RESOLVED" ? "View market & claim" : "View market"}</Link></Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
        {c.participants.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Participants</CardTitle></CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2 text-sm">
                {c.participants.slice(0, 50).map((p) => (
                  <li key={p.userId}>
                    <Link href={`/profile/${p.user.username}`} className={cn("rounded-full px-2.5 py-1 hover:text-primary", p.betAgainstAt ? "bg-no-soft text-no" : "bg-muted")}
                      title={p.betAgainstAt ? "Holds NO shares on their own challenge" : undefined}>
                      @{p.user.username}{p.status === "COMPLETED" && " ✓"}
                      {(positions.get(p.userId)?.yes ?? 0n) > 0n && <span className="ml-1 text-xs text-yes">YES</span>}
                      {p.betAgainstAt && <span className="ml-1 text-xs">⚠ bet NO</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  );
}
