import type { Fetch } from "./http";

/** Member count of a Telegram chat via the Bot API `getChatMemberCount`. Null when unavailable. */
export async function telegramMemberCount(botToken: string, chatId: bigint | string, f: Fetch = fetch, apiRoot = "https://api.telegram.org"): Promise<number | null> {
  const r = await f(`${apiRoot.replace(/\/$/, "")}/bot${botToken}/getChatMemberCount?chat_id=${encodeURIComponent(String(chatId))}`).catch(() => null);
  if (!r?.ok) return null;
  const d = (await r.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
  return d?.ok && typeof d.result === "number" ? d.result : null;
}
