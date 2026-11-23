import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM for OAuth tokens at rest. Any ACCOUNT_TOKEN_KEY string works (hashed to 32 bytes). */
function key(secret: string): Buffer {
  if (!secret || secret.trim().length < 32) throw new Error("ACCOUNT_TOKEN_KEY must be set (32+ characters)");
  return createHash("sha256").update(secret.trim()).digest();
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(enc: string, secret: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised token format");
  const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
