import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Actor, ServiceContext } from "./context";
import { conflict, forbidden, invalid, isUniqueViolation, notFound, ServiceError } from "./errors";
import { audit } from "./audit";

const CreateSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});

function slugify(name: string) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "community"}-${randomBytes(2).toString("hex")}`;
}

export async function createCommunity(ctx: ServiceContext, actor: Actor, raw: unknown) {
  const p = CreateSchema.safeParse(raw);
  if (!p.success) throw invalid("Validation failed", z.flattenError(p.error).fieldErrors);
  const c = await ctx.db.community.create({
    data: { ...p.data, slug: slugify(p.data.name), creatorId: actor.id, members: { create: { userId: actor.id, role: "OWNER" } } },
  });
  await audit(ctx.db, actor.id, "community.created", "Community", c.id);
  return c;
}

export async function joinCommunity(ctx: ServiceContext, actor: Actor, communityId: string, inviteCode?: string) {
  const c = await ctx.db.community.findUnique({ where: { id: communityId } });
  if (!c) throw notFound("Community not found");
  if (c.visibility === "PRIVATE") {
    if (!inviteCode) throw forbidden("This community is invite-only");
    const inv = await ctx.db.communityInvite.findUnique({ where: { code: inviteCode } });
    const now = ctx.now();
    if (!inv || inv.communityId !== c.id || (inv.expiresAt && inv.expiresAt < now) || (inv.maxUses !== null && inv.uses >= inv.maxUses)) throw forbidden("Invite is invalid or expired");
    await ctx.db.communityInvite.update({ where: { id: inv.id }, data: { uses: { increment: 1 } } });
  }
  try {
    return await ctx.db.communityMember.create({ data: { communityId, userId: actor.id, role: "MEMBER" } });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("You are already a member");
    throw e;
  }
}

export async function setMemberRole(ctx: ServiceContext, actor: Actor, communityId: string, username: string, role: "ADMIN" | "VERIFIER" | "MEMBER") {
  const me = await ctx.db.communityMember.findUnique({ where: { communityId_userId: { communityId, userId: actor.id } } });
  if (me?.role !== "OWNER" && actor.role !== "PLATFORM_ADMIN") throw forbidden("Only the community owner can change roles");
  const user = await ctx.db.user.findUnique({ where: { username: username.toLowerCase() } });
  if (!user) throw notFound("User not found");
  const m = await ctx.db.communityMember.update({ where: { communityId_userId: { communityId, userId: user.id } }, data: { role } }).catch(() => null);
  if (!m) throw notFound("That user is not a member");
  await audit(ctx.db, actor.id, "community.role_changed", "Community", communityId, { userId: user.id, role });
  return m;
}

// ───────────── Telegram linking (used by the bot) ─────────────

async function consumeCode(ctx: ServiceContext, code: string, purpose: "LINK_ACCOUNT" | "LINK_GROUP") {
  const row = await ctx.db.telegramLinkCode.findUnique({ where: { code }, include: { user: true } });
  if (!row || row.purpose !== purpose) throw new ServiceError(400, "This link is invalid. Generate a new one on the GoalFi website.");
  if (row.usedAt) throw new ServiceError(400, "This link was already used. Generate a new one on the GoalFi website.");
  if (row.expiresAt < ctx.now()) throw new ServiceError(400, "This link has expired. Generate a new one on the GoalFi website.");
  return row;
}

async function markUsed(ctx: ServiceContext, id: string, chatId?: bigint) {
  const r = await ctx.db.telegramLinkCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: ctx.now(), telegramChatId: chatId ?? null } });
  if (r.count !== 1) throw new ServiceError(400, "This link was already used.");
}

/** Private chat `/start <code>`: bind the Telegram user to the GoalFi account that generated the code. */
export async function linkTelegramAccount(ctx: ServiceContext, code: string, tg: { id: number; username?: string }) {
  const row = await consumeCode(ctx, code, "LINK_ACCOUNT");
  const tgId = BigInt(tg.id);
  const other = await ctx.db.user.findUnique({ where: { telegramId: tgId } });
  if (other && other.id !== row.userId) throw conflict("This Telegram account is already linked to another GoalFi user.");
  await markUsed(ctx, row.id);
  const user = await ctx.db.user.update({ where: { id: row.userId }, data: { telegramId: tgId, telegramUsername: tg.username ?? null } });
  await audit(ctx.db, user.id, "user.telegram_linked", "User", user.id, { via: "bot" });
  return user;
}

export interface GroupLinkInput {
  code: string;
  chatId: number;
  chatTitle: string;
  /** Telegram user who sent /start in the group (the person who added the bot). */
  fromTelegramId: number;
  /** Bot-side checks via the Bot API (getChatMember). */
  isChatAdmin: (telegramUserId: number) => Promise<boolean>;
  botIsMember: () => Promise<boolean>;
}

/**
 * Group `/start <code>` (sent automatically after the user chose a group via ?startgroup=).
 * Verifies the bot joined, the sender is a group admin, and the sender is the GoalFi user who
 * created the code, then links (or creates) the community.
 */
export async function linkTelegramGroup(ctx: ServiceContext, i: GroupLinkInput) {
  const row = await consumeCode(ctx, i.code, "LINK_GROUP");
  if (row.user.telegramId === null || row.user.telegramId !== BigInt(i.fromTelegramId))
    throw forbidden("Link your Telegram account to GoalFi first (GoalFi → Settings → Telegram), then add the bot again.");
  if (!(await i.botIsMember())) throw new ServiceError(400, "The bot is not a member of this group.");
  if (!(await i.isChatAdmin(i.fromTelegramId))) throw forbidden("Only group administrators can connect this group to GoalFi.");
  const chatId = BigInt(i.chatId);
  const existing = await ctx.db.community.findUnique({ where: { telegramChatId: chatId } });
  if (existing && existing.creatorId !== row.userId) {
    // Another GoalFi user connected it before; group admins can take it over, keeping members.
    await ctx.db.communityMember.upsert({
      where: { communityId_userId: { communityId: existing.id, userId: row.userId } },
      update: { role: "ADMIN" }, create: { communityId: existing.id, userId: row.userId, role: "ADMIN" },
    });
  }
  await markUsed(ctx, row.id, chatId);
  const community = existing
    ? await ctx.db.community.update({ where: { id: existing.id }, data: { telegramTitle: i.chatTitle, telegramLinkedAt: ctx.now() } })
    : await ctx.db.community.create({
        data: {
          name: i.chatTitle.slice(0, 60) || "Telegram group", slug: slugify(i.chatTitle), creatorId: row.userId, visibility: "PUBLIC",
          telegramChatId: chatId, telegramTitle: i.chatTitle, telegramLinkedAt: ctx.now(),
          members: { create: { userId: row.userId, role: "OWNER" } },
        },
      });
  await audit(ctx.db, row.userId, "community.telegram_linked", "Community", community.id, { chatId: i.chatId });
  return community;
}

/** Bot removed from a group: keep the community, drop the chat link. */
export async function unlinkTelegramGroup(ctx: ServiceContext, chatId: number) {
  const r = await ctx.db.community.updateMany({ where: { telegramChatId: BigInt(chatId) }, data: { telegramChatId: null, telegramLinkedAt: null } });
  return r.count;
}

/** Group upgraded to a supergroup: Telegram assigns a new chat id. */
export async function migrateTelegramChat(ctx: ServiceContext, fromChatId: number, toChatId: number) {
  await ctx.db.community.updateMany({ where: { telegramChatId: BigInt(fromChatId) }, data: { telegramChatId: BigInt(toChatId) } });
  await ctx.db.telegramOutbox.updateMany({ where: { chatId: BigInt(fromChatId), sentAt: null }, data: { chatId: BigInt(toChatId) } });
}

/** A Telegram member of a linked group joins the community (requires a linked GoalFi account). */
export async function joinCommunityByTelegram(ctx: ServiceContext, chatId: number, telegramUserId: number) {
  const c = await ctx.db.community.findUnique({ where: { telegramChatId: BigInt(chatId) } });
  const u = await ctx.db.user.findUnique({ where: { telegramId: BigInt(telegramUserId) } });
  if (!c || !u) return null;
  return ctx.db.communityMember.upsert({
    where: { communityId_userId: { communityId: c.id, userId: u.id } },
    update: {}, create: { communityId: c.id, userId: u.id, role: "MEMBER" },
  });
}
