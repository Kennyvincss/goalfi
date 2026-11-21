import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Payload sent by the Telegram Login Widget (https://core.telegram.org/widgets/login). */
export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const MAX_AGE_SECS = 24 * 3600;

/**
 * Verify per Telegram's spec: data_check_string = sorted "key=value" lines (excluding hash),
 * secret_key = SHA256(bot_token), hash = HMAC_SHA256(data_check_string, secret_key) in hex.
 */
export function verifyTelegramLogin(
  data: Record<string, unknown>,
  botToken: string,
  nowSecs = Math.floor(Date.now() / 1000),
): { ok: true; user: TelegramAuthData } | { ok: false; reason: string } {
  if (!botToken) return { ok: false, reason: "Telegram login is not configured" };
  const hash = typeof data.hash === "string" ? data.hash : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "Missing hash" };
  const allowed = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];
  const checkString = Object.keys(data)
    .filter((k) => k !== "hash" && allowed.includes(k) && data[k] !== undefined && data[k] !== null)
    .sort()
    .map((k) => `${k}=${String(data[k])}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "Invalid signature" };
  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || nowSecs - authDate > MAX_AGE_SECS) return { ok: false, reason: "Login data expired" };
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "Invalid id" };
  return {
    ok: true,
    user: {
      id,
      auth_date: authDate,
      hash,
      first_name: data.first_name as string | undefined,
      last_name: data.last_name as string | undefined,
      username: data.username as string | undefined,
      photo_url: data.photo_url as string | undefined,
    },
  };
}
