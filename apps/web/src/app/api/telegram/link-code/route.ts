import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@goalfi/db";
import { HttpError, requireUser } from "@/lib/server/auth";
import { json, parseBody, rateLimit, route } from "@/lib/server/api";

const Body = z.object({
  purpose: z.enum(["LINK_ACCOUNT", "LINK_GROUP"]),
  /** LINK_GROUP only: connect the group to this existing community instead of creating a new one. */
  communityId: z.string().min(1).optional(),
});

/**
 * One-time code for Telegram deep links (valid 30 min, single use).
 * - LINK_GROUP:   t.me/<bot>?startgroup=<code>. The user picks a group and Telegram adds the bot.
 *                 The bot then verifies (getChatMember) that the user who added it is a group admin
 *                 and that this Telegram user is linked to the code's GoalFi account.
 * - LINK_ACCOUNT: t.me/<bot>?start=<code> in a private chat links the Telegram user to this account.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`tg-code:${user.id}`, 10, 600);
  const { purpose, communityId } = await parseBody(req, Body);
  if (communityId) {
    if (purpose !== "LINK_GROUP") throw new HttpError(422, "communityId is only for group links");
    const m = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId: user.id } }, include: { community: true } });
    if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) throw new HttpError(403, "You can only connect communities you own or administer");
    if (m.community.telegramChatId) throw new HttpError(409, `“${m.community.name}” is already connected to a Telegram group`);
  }
  const code = randomBytes(12).toString("base64url"); // 16 chars: within Telegram's 64-char [A-Za-z0-9_-] limit
  await prisma.telegramLinkCode.create({ data: { code, purpose, userId: user.id, communityId: communityId ?? null, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "GoalFiBot";
  const url = purpose === "LINK_GROUP" ? `https://t.me/${bot}?startgroup=${code}` : `https://t.me/${bot}?start=${code}`;
  return json({ code, url, expiresInSecs: 1800 });
});
