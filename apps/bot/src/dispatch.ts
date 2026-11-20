import { GrammyError, InlineKeyboard, type Api } from "grammy";
import type { NotificationType } from "@goalfi/db";
import type { ServiceContext } from "@goalfi/services";
import { esc } from "./format";

/** Types sent to Telegram unless the user opted out. TRADE_CONFIRMED stays in-app by default to avoid spam. */
const TELEGRAM_DEFAULT_OFF = new Set<NotificationType>(["TRADE_CONFIRMED"]);
const MAX_AGE_MS = 24 * 3_600_000;

function permanent(e: unknown): boolean {
  return e instanceof GrammyError && (e.error_code === 403 || (e.error_code === 400 && /chat not found|user is deactivated/i.test(e.description)));
}

/** Deliver pending in-app notifications to users who linked Telegram. */
export async function deliverNotifications(api: Api, svc: ServiceContext, batch = 50): Promise<number> {
  const since = new Date(svc.now().getTime() - MAX_AGE_MS);
  const rows = await svc.db.notification.findMany({
    where: { telegramSentAt: null, createdAt: { gte: since }, user: { telegramId: { not: null } } },
    orderBy: { createdAt: "asc" }, take: batch,
    include: { user: { select: { telegramId: true, notificationPrefs: true } } },
  });
  let sent = 0;
  for (const n of rows) {
    const pref = n.user.notificationPrefs.find((p) => p.type === n.type);
    const wanted = pref ? pref.telegram : !TELEGRAM_DEFAULT_OFF.has(n.type);
    if (wanted) {
      const kb = new InlineKeyboard();
      if (n.type === "EVIDENCE_RECEIVED" && n.dedupKey?.startsWith("EVIDENCE_RECEIVED:")) kb.text("✅ Approve", `rv:a:${n.dedupKey.split(":")[1]}`);
      if (n.link) kb.url(n.type === "EVIDENCE_RECEIVED" ? "Review / reject" : "Open GoalFi", n.link);
      try {
        await api.sendMessage(Number(n.user.telegramId), esc(n.message), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
        sent++;
      } catch (e) {
        if (!permanent(e)) continue; // transient: retry on the next tick
      }
    }
    // Processed (sent, opted out, or permanently undeliverable).
    await svc.db.notification.update({ where: { id: n.id }, data: { telegramSentAt: svc.now() } });
  }
  return sent;
}

/** Deliver queued community announcements to Telegram groups. */
export async function deliverOutbox(api: Api, svc: ServiceContext, batch = 20): Promise<number> {
  const rows = await svc.db.telegramOutbox.findMany({ where: { sentAt: null, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: batch });
  let sent = 0;
  for (const m of rows) {
    const kb = new InlineKeyboard();
    for (const b of (m.buttons as { text: string; url: string }[] | null) ?? []) kb.url(b.text, b.url).row();
    try {
      await api.sendMessage(Number(m.chatId), esc(m.text), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
      await svc.db.telegramOutbox.update({ where: { id: m.id }, data: { sentAt: svc.now(), attempts: { increment: 1 } } });
      sent++;
    } catch (e) {
      await svc.db.telegramOutbox.update({
        where: { id: m.id },
        data: { attempts: permanent(e) ? 99 : { increment: 1 }, lastError: (e as Error).message.slice(0, 300) },
      });
    }
  }
  return sent;
}
