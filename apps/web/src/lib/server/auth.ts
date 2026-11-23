import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { prisma, type User } from "@goalfi/db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "goalfi_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, SCRYPT);
  return timingSafeEqual(key, expected);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = Pick<
  User,
  "id" | "username" | "displayName" | "role" | "walletAddress" | "telegramId" | "telegramUsername" | "reputationScore" | "avatarUrl" | "email"
>;

const userSelect = {
  id: true, username: true, displayName: true, role: true, walletAddress: true, telegramId: true,
  telegramUsername: true, reputationScore: true, avatarUrl: true, email: true, suspendedAt: true,
} as const;

/** Current user from the session cookie, or null. Suspended users are treated as signed out. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: userSelect } } });
  if (!session || session.expiresAt < new Date() || session.user.suspendedAt) return null;
  const { suspendedAt: _s, ...user } = session.user;
  return user;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "Sign in required");
  return u;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "PLATFORM_ADMIN") throw new HttpError(403, "Platform administrators only");
  return u;
}

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Derive an available username from a preferred handle. */
export async function availableUsername(preferred: string): Promise<string> {
  const base = (preferred.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "goalfi").padEnd(3, "0");
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 18)}${Math.floor(Math.random() * 10_000)}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `user${randomBytes(4).toString("hex")}`;
}
