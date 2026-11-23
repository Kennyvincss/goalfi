import type { NotificationType, Prisma } from "@goalfi/db";
import type { ServiceContext } from "./context";

type Db = ServiceContext["db"] | Prisma.TransactionClient;

/**
 * Create in-app notifications (deduplicated per user by `dedupKey`). Telegram delivery is done
 * by the bot's dispatcher, which honours each user's preferences.
 */
export async function notify(
  db: Db,
  userIds: string[],
  n: { type: NotificationType; message: string; link?: string; dedupKey: string },
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const muted = await db.notificationPreference.findMany({
    where: { userId: { in: unique }, type: n.type, web: false, telegram: false },
    select: { userId: true },
  });
  const skip = new Set(muted.map((m) => m.userId));
  const res = await db.notification.createMany({
    data: unique.filter((u) => !skip.has(u)).map((userId) => ({ userId, type: n.type, message: n.message, link: n.link, dedupKey: n.dedupKey })),
    skipDuplicates: true,
  });
  return res.count;
}

/** Queue a message for a community's linked Telegram group (no-op if not linked). */
export async function announceToCommunity(
  db: Db,
  communityId: string | null,
  msg: { text: string; buttons?: { text: string; url: string }[]; dedupKey: string },
): Promise<boolean> {
  if (!communityId) return false;
  const c = await db.community.findUnique({ where: { id: communityId }, select: { telegramChatId: true } });
  if (!c?.telegramChatId) return false;
  await db.telegramOutbox.upsert({
    where: { dedupKey: msg.dedupKey },
    update: {},
    create: { chatId: c.telegramChatId, text: msg.text, buttons: msg.buttons ?? undefined, dedupKey: msg.dedupKey },
  });
  return true;
}
