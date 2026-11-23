import { prisma } from "@goalfi/db";
import { availableUsername, createSession, getCurrentUser, HttpError } from "@/lib/server/auth";
import { audit, clientIp, json, rateLimit, route } from "@/lib/server/api";
import { verifyTelegramLogin } from "@/lib/server/telegram-auth";

/**
 * Telegram Login Widget callback. Signs in (or creates) the account bound to the Telegram id.
 * If a user is already signed in, links Telegram to that account instead.
 */
export const POST = route(async (req) => {
  const ip = clientIp(req);
  await rateLimit(`tg-login:${ip}`, 20, 900);
  const data = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new HttpError(400, "Invalid body");
  const v = verifyTelegramLogin(data, process.env.TELEGRAM_BOT_TOKEN ?? "");
  if (!v.ok) throw new HttpError(401, v.reason);
  const tgId = BigInt(v.user.id);
  const current = await getCurrentUser();
  const owner = await prisma.user.findUnique({ where: { telegramId: tgId } });

  if (current) {
    if (owner && owner.id !== current.id) throw new HttpError(409, "This Telegram account is linked to another GoalFi user");
    await prisma.user.update({ where: { id: current.id }, data: { telegramId: tgId, telegramUsername: v.user.username ?? null } });
    await audit(current.id, "user.telegram_linked", "User", current.id, { telegramId: v.user.id }, ip);
    return json({ ok: true, linked: true });
  }

  const user =
    owner ??
    (await prisma.user.create({
      data: {
        username: await availableUsername(v.user.username ?? v.user.first_name ?? "goalfi"),
        displayName: [v.user.first_name, v.user.last_name].filter(Boolean).join(" ") || v.user.username || null,
        telegramId: tgId,
        telegramUsername: v.user.username ?? null,
        avatarUrl: v.user.photo_url ?? null,
      },
    }));
  if (user.suspendedAt) throw new HttpError(403, "This account is suspended");
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
  if (!owner) await audit(user.id, "user.signup", "User", user.id, { method: "telegram" }, ip);
  return json({ ok: true, username: user.username });
});
