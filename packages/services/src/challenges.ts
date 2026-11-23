import { randomBytes } from "node:crypto";
import {
  accountOldEnough,
  appMetric,
  easyToGameReason,
  marketLimits,
  PROVIDER_INFO,
  type AccountProviderId,
  canJoin,
  CreateChallengeSchema,
  MarketConfigSchema,
  onchainMarketName,
  PM_AMM_LIMITS,
  publishedStatus,
  toMicro,
  type CreateChallengeInput,
  type MarketConfig,
} from "@goalfi/core";
import type { Prisma } from "@goalfi/db";
import { z } from "zod";
import { challengeAccess, requireView } from "./authz";
import { link, trustDays, type Actor, type ServiceContext } from "./context";
import { conflict, forbidden, invalid, isUniqueViolation, notFound, ServiceError } from "./errors";
import { announceToCommunity, notify } from "./notifications";
import { audit } from "./audit";
import { accountReadyFor } from "./accounts/service";
import { holdsNo } from "./integrity";

function slugify(title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "challenge";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

async function usersByUsername(ctx: ServiceContext, names: string[], label: string) {
  const wanted = [...new Set(names.map((n) => n.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const users = await ctx.db.user.findMany({ where: { username: { in: wanted }, suspendedAt: null }, select: { id: true, username: true } });
  const missing = wanted.filter((w) => !users.some((u) => u.username === w));
  if (missing.length) throw invalid(`Unknown ${label}: ${missing.map((m) => "@" + m).join(", ")}`);
  return users;
}

/** Step 1: create a DRAFT. Nothing is public and no market exists until the creator confirms. */
export async function createChallenge(ctx: ServiceContext, actor: Actor, raw: unknown) {
  const parsed = CreateChallengeSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const input: CreateChallengeInput = parsed.data;

  const category = await ctx.db.category.findFirst({ where: { slug: input.categorySlug, active: true } });
  if (!category) throw invalid("Unknown category");
  if (input.communityId) {
    const m = await ctx.db.communityMember.findUnique({ where: { communityId_userId: { communityId: input.communityId, userId: actor.id } } });
    if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) throw forbidden("Only community admins can create challenges in this community");
  }
  if (input.verification === "CONNECTED_APP" && input.app?.metric === "telegram_members") {
    const comm = await ctx.db.community.findUnique({ where: { id: input.communityId! }, select: { telegramChatId: true } });
    if (!comm?.telegramChatId) throw invalid("Connect this community to a Telegram group first (Telegram page), so GoalFi can count its members");
  }
  if (input.market.type === "MULTI_OUTCOME" || input.market.type === "COMMITMENT_VAULT")
    throw invalid("This market type is not enabled yet. It's pending devnet verification (see docs/PM_AMM_INTEGRATION.md). Use a YES/NO market or no market.");
  if (input.market.type !== "NONE" && !ctx.gateway) throw new ServiceError(503, "Market creation is not configured on this server");
  if (input.market.type === "BINARY" && actor.role !== "PLATFORM_ADMIN") {
    // Caps what a group could take from the pool by manipulating its own outcome.
    const creator = await ctx.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { reputationScore: true } });
    const easy = easyToGameReason({ verificationMethod: input.verification, appMetric: input.app?.metric ?? null });
    const { maxInitialLiquidityUsdc } = marketLimits({ easyToGame: !!easy, creatorReputation: creator.reputationScore, trustedParticipants: 0 });
    if (input.market.initialLiquidityUsdc > maxInitialLiquidityUsdc) {
      const msg = `At most ${maxInitialLiquidityUsdc} for this challenge (${easy ? "this metric is easier to game; " : ""}the limit grows with your reputation)`;
      throw invalid("Validation failed", { initialLiquidityUsdc: [msg] });
    }
  }

  const verifiers = await usersByUsername(ctx, input.verifierUsernames, "verifier");
  const admins = await usersByUsername(ctx, input.adminUsernames, "administrator");

  const challenge = await ctx.db.challenge.create({
    data: {
      slug: slugify(input.title),
      communityId: input.communityId ?? null,
      creatorId: actor.id,
      categoryId: category.id,
      title: input.title,
      description: input.description,
      rules: input.rules,
      successCriteria: input.successCriteria,
      successRule: input.successRule,
      participationReq: input.participationReq ?? null,
      evidenceReq: input.evidenceReq,
      kind: input.kind,
      visibility: input.visibility,
      recurrence: input.recurrence,
      requiredApprovals: input.requiredApprovals,
      disputeWindowHours: input.disputeWindowHours,
      reviewDeadlineHours: input.reviewDeadlineHours ?? null,
      autoSettle: input.autoSettle,
      verificationMethod: input.verification,
      appMetric: input.verification === "CONNECTED_APP" ? input.app!.metric : null,
      appDailyTarget: input.verification === "CONNECTED_APP" && input.successRule.type === "daily_completion" ? (input.app!.dailyTarget ?? null) : null,
      maxParticipants: input.maxParticipants ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "DRAFT",
      marketEnabled: input.market.type !== "NONE",
      marketQuestion: input.marketQuestion,
      marketConfig: input.market,
      roles: {
        create: [
          { userId: actor.id, role: "ADMIN" },
          ...admins.filter((a) => a.id !== actor.id).map((a) => ({ userId: a.id, role: "ADMIN" as const })),
          ...verifiers.map((v) => ({ userId: v.id, role: "VERIFIER" as const })),
        ],
      },
    },
  });
  await audit(ctx.db, actor.id, "challenge.draft_created", "Challenge", challenge.id);
  return challenge;
}

/** Discard a draft (creator only). */
export async function deleteDraft(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId } });
  if (!c || c.creatorId !== actor.id) throw notFound("Challenge not found");
  if (c.status !== "DRAFT") throw conflict("Only drafts can be deleted");
  await ctx.db.challenge.delete({ where: { id: c.id } });
}

/**
 * Step 2: the creator confirms the summary. The rules are now frozen.
 *  - No market  → published immediately.
 *  - YES/NO     → a pm-AMM market is created on-chain by the platform authority. The challenge goes
 *                 live once the creator funds the configured initial liquidity (see transactions.ts).
 */
export async function confirmChallenge(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId } });
  if (!c || c.creatorId !== actor.id) throw notFound("Challenge not found");
  if (c.status !== "DRAFT") throw conflict("Challenge is already confirmed");
  const now = ctx.now();
  if (c.endDate <= now) throw invalid("The end date has already passed. Edit the dates first.");
  const market = MarketConfigSchema.parse(c.marketConfig ?? { type: "NONE" }) as MarketConfig;

  if (market.type === "NONE") {
    const confirmed = await ctx.db.challenge.update({
      where: { id: c.id, status: "DRAFT" },
      data: { status: publishedStatus(c.startDate, now), rulesConfirmedAt: now },
    });
    await afterPublish(ctx, confirmed.id);
    await audit(ctx.db, actor.id, "challenge.confirmed", "Challenge", c.id, { market: "NONE" });
    return { challenge: confirmed, market: null };
  }
  if (market.type !== "BINARY") throw invalid("Unsupported market type");
  const gw = ctx.gateway;
  if (!gw) throw new ServiceError(503, "Market creation is not configured on this server");
  const secs = (c.endDate.getTime() - now.getTime()) / 1000;
  if (secs < PM_AMM_LIMITS.MARKET_MIN_SECS || secs > PM_AMM_LIMITS.MARKET_MAX_SECS)
    throw invalid("Markets must close between 5 minutes and 30 days from now (pm-AMM limit). Adjust the end date.");

  // Intent first: the market row (with its pre-chosen on-chain id) exists before anything is sent.
  const onchainId = gw.newOnchainId();
  const { challenge: confirmed, marketRow } = await ctx.db.$transaction(async (tx) => {
    const confirmed = await tx.challenge.update({ where: { id: c.id, status: "DRAFT" }, data: { status: "PENDING_MARKET", rulesConfirmedAt: now } });
    const marketRow = await tx.market.create({
      data: {
        challengeId: c.id,
        cluster: gw.cluster,
        programId: gw.programId,
        collateralMint: gw.collateralMint,
        marketType: "BINARY",
        onchainId: onchainId.toString(),
        marketAddress: gw.marketAddressFor(onchainId),
        authority: gw.authority,
        initialPriceBps: market.initialPriceBps,
        liquidityTargetUsdc: toMicro(market.initialLiquidityUsdc),
        endTs: c.endDate,
        status: "CREATING",
      },
    });
    return { challenge: confirmed, marketRow };
  });
  await audit(ctx.db, actor.id, "challenge.confirmed", "Challenge", c.id, { market: "BINARY", onchainId: onchainId.toString() });
  const created = await createMarketOnchain(ctx, marketRow.id);
  return { challenge: confirmed, market: created };
}

/** Create (or re-try creating) the on-chain market for a CREATING row. Idempotent. */
export async function createMarketOnchain(ctx: ServiceContext, marketId: string) {
  const gw = ctx.gateway;
  if (!gw) throw new ServiceError(503, "Market creation is not configured on this server");
  const m = await ctx.db.market.findUnique({ where: { id: marketId }, include: { challenge: true } });
  if (!m) throw notFound("Market not found");
  if (m.status !== "CREATING") return m;
  try {
    const res = await gw.createBinaryMarket(
      { onchainId: BigInt(m.onchainId), endTs: m.endTs, name: onchainMarketName(m.challenge.marketQuestion ?? m.challenge.title), initialPriceBps: m.initialPriceBps },
      async (signature) => {
        await ctx.db.market.update({ where: { id: m.id }, data: { creationSignature: signature } });
      },
    );
    const updated = await ctx.db.market.update({
      where: { id: m.id },
      data: { status: "AWAITING_LIQUIDITY", marketAddress: res.address, ...(res.signature ? { creationSignature: res.signature } : {}), lastError: null },
    });
    const sig = res.signature ?? updated.creationSignature;
    if (sig) {
      // Record only real signatures. (null = the PDA already existed, e.g. after a crash mid-create.)
      await ctx.db.transaction.upsert({
        where: { signature: sig },
        update: { status: "CONFIRMED", confirmedAt: ctx.now() },
        create: { signature: sig, kind: "CREATE_MARKET", marketId: m.id, status: "CONFIRMED", confirmedAt: ctx.now() },
      });
    }
    await notify(ctx.db, [m.challenge.creatorId], {
      type: "MARKET_UPDATE",
      message: `Your market for “${m.challenge.title}” is on-chain. Fund the initial liquidity to go live.`,
      link: link(ctx, `/challenges/${m.challenge.slug}`),
      dedupKey: `MARKET_CREATED:${m.id}`,
    });
    return updated;
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    await ctx.db.market.update({ where: { id: m.id }, data: { lastError: msg } });
    throw new ServiceError(502, `On-chain market creation failed: ${msg}. You can retry.`);
  }
}

export async function retryMarketCreation(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const a = await challengeAccess(ctx.db, challengeId, actor);
  if (!a.isAdmin) throw forbidden();
  if (!a.challenge.market) throw notFound("No market");
  return createMarketOnchain(ctx, a.challenge.market.id);
}

/** Notify + announce once a challenge becomes visible. Idempotent via dedup keys. */
export async function afterPublish(ctx: ServiceContext, challengeId: string) {
  const c = await ctx.db.challenge.findUnique({ where: { id: challengeId }, include: { market: true } });
  if (!c || c.visibility === "PRIVATE") return;
  const url = link(ctx, `/challenges/${c.slug}`);
  if (c.communityId) {
    const members = await ctx.db.communityMember.findMany({ where: { communityId: c.communityId, userId: { not: c.creatorId } }, select: { userId: true } });
    await notify(ctx.db, members.map((m) => m.userId), { type: "CHALLENGE_NEW", message: `New challenge: ${c.title}`, link: url, dedupKey: `CHALLENGE_NEW:${c.id}` });
    await announceToCommunity(ctx.db, c.communityId, {
      text: `🎯 New challenge: ${c.title}\n\n${c.successCriteria}\n\nRuns ${c.startDate.toUTCString().slice(0, 16)} → ${c.endDate.toUTCString().slice(0, 16)}${c.market ? "\n📈 Prediction market live on GoalFi" : ""}`,
      buttons: [{ text: "View & join", url }],
      dedupKey: `ANNOUNCE_NEW:${c.id}`,
    });
  }
}

/**
 * Start an upcoming challenge right away (challenge admins). App-verified challenges run on whole
 * local days, so their start moves back in whole days to the last day boundary before now.
 */
export async function startChallengeNow(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const a = await requireView(ctx.db, challengeId, actor);
  if (!a.isAdmin) throw forbidden("Only challenge administrators can start it");
  const c = a.challenge;
  if (c.status !== "UPCOMING") throw conflict("Only upcoming challenges can be started early");
  const now = ctx.now();
  const DAY = 86_400_000;
  const start = c.verificationMethod === "CONNECTED_APP"
    ? new Date(c.startDate.getTime() - Math.ceil((c.startDate.getTime() - now.getTime()) / DAY) * DAY)
    : now;
  const r = await ctx.db.challenge.updateMany({ where: { id: c.id, status: "UPCOMING" }, data: { startDate: start, status: "ACTIVE" } });
  if (r.count !== 1) throw conflict("Only upcoming challenges can be started early");
  await audit(ctx.db, actor.id, "challenge.started_early", "Challenge", c.id, { previousStart: c.startDate.toISOString() });
  const ps = await ctx.db.participant.findMany({ where: { challengeId: c.id, status: { not: "WITHDRAWN" } }, select: { userId: true } });
  await notify(ctx.db, ps.map((p) => p.userId), { type: "MARKET_UPDATE", message: `▶️ “${c.title}” has started.`, link: link(ctx, `/challenges/${c.slug}`), dedupKey: `STARTED:${c.id}` });
  return ctx.db.challenge.findUniqueOrThrow({ where: { id: c.id } });
}

export async function joinChallenge(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const a = await requireView(ctx.db, challengeId, actor);
  const c = a.challenge;
  if (!canJoin(c.status)) throw conflict("This challenge is not open for joining");
  if (c.visibility === "PRIVATE" && !a.isAdmin && !a.isVerifier) throw forbidden("This challenge is invite-only");
  if (c.maxParticipants) {
    const n = await ctx.db.participant.count({ where: { challengeId } });
    if (n >= c.maxParticipants) throw conflict("This challenge is full");
  }
  if (c.marketEnabled) {
    const me = await ctx.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { createdAt: true, walletAddress: true } });
    const days = trustDays(ctx);
    if (!accountOldEnough(me.createdAt, ctx.now(), days))
      throw conflict(`Accounts can join challenges that have a prediction market once they’re ${days} day${days === 1 ? "" : "s"} old. This stops groups from creating fake accounts to swing a result.`);
    const market = await ctx.db.market.findUnique({ where: { challengeId }, select: { id: true, marketAddress: true } });
    if (market && (await holdsNo(ctx, { id: actor.id, walletAddress: me.walletAddress }, market)))
      throw conflict("You hold NO shares on this challenge’s market. Participants can’t bet against themselves: sell them first, then join.");
  }
  const metric = c.verificationMethod === "CONNECTED_APP" ? appMetric(c.appMetric) : null;
  if (metric && metric.source !== "level") {
    const provider = metric.provider as AccountProviderId;
    const acct = await ctx.db.connectedAccount.findUnique({ where: { userId_provider: { userId: actor.id, provider } } });
    if (!accountReadyFor(acct, metric))
      throw conflict(
        acct && acct.status === "ACTIVE"
          ? `This challenge needs sleep data: reconnect ${PROVIDER_INFO[provider].name} in Settings and allow sleep access.`
          : `This challenge is verified from ${PROVIDER_INFO[provider].name}. Connect your account in Settings → Connected accounts first.`,
      );
  }
  try {
    const p = await ctx.db.participant.create({ data: { challengeId, userId: actor.id } });
    return p;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("You already joined this challenge");
    throw e;
  }
}

export async function leaveChallenge(ctx: ServiceContext, actor: Actor, challengeId: string) {
  const p = await ctx.db.participant.findUnique({ where: { challengeId_userId: { challengeId, userId: actor.id } }, include: { _count: { select: { evidence: true } } } });
  if (!p) throw notFound("You are not a participant");
  if (p._count.evidence > 0) {
    // Keep the record (evidence references it), just mark withdrawn.
    return ctx.db.participant.update({ where: { id: p.id }, data: { status: "WITHDRAWN" } });
  }
  await ctx.db.participant.delete({ where: { id: p.id } });
  return null;
}

export type ChallengeWithAll = Prisma.ChallengeGetPayload<{ include: { roles: true; market: true } }>;
