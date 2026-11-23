import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramLogin } from "./telegram-auth";

const TOKEN = "123456:TEST";
function sign(data: Record<string, string | number>) {
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n");
  return createHmac("sha256", createHash("sha256").update(TOKEN).digest()).update(check).digest("hex");
}

describe("verifyTelegramLogin", () => {
  const now = 1_800_000_000;
  const data = { id: 42, first_name: "Ada", username: "ada", auth_date: now - 60 };
  it("accepts a correctly signed payload", () => {
    const r = verifyTelegramLogin({ ...data, hash: sign(data) }, TOKEN, now);
    expect(r).toMatchObject({ ok: true, user: { id: 42, username: "ada" } });
  });
  it("rejects tampered fields", () => {
    expect(verifyTelegramLogin({ ...data, id: 43, hash: sign(data) }, TOKEN, now).ok).toBe(false);
  });
  it("rejects a signature made with another bot token", () => {
    const other = createHmac("sha256", createHash("sha256").update("999:OTHER").digest())
      .update(Object.keys(data).sort().map((k) => `${k}=${data[k as keyof typeof data]}`).join("\n")).digest("hex");
    expect(verifyTelegramLogin({ ...data, hash: other }, TOKEN, now).ok).toBe(false);
  });
  it("rejects stale logins (> 24h)", () => {
    const old = { ...data, auth_date: now - 25 * 3600 };
    expect(verifyTelegramLogin({ ...old, hash: sign(old) }, TOKEN, now)).toMatchObject({ ok: false, reason: "Login data expired" });
  });
  it("ignores unknown fields in the check string but rejects missing hash and missing token", () => {
    expect(verifyTelegramLogin({ ...data, extra: "x", hash: sign(data) }, TOKEN, now).ok).toBe(true);
    expect(verifyTelegramLogin({ ...data }, TOKEN, now).ok).toBe(false);
    expect(verifyTelegramLogin({ ...data, hash: sign(data) }, "", now).ok).toBe(false);
  });
});
