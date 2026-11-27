import { z } from "zod";
import { prisma } from "@goalfi/db";
import { createSession, hashPassword, HttpError, USERNAME_RE } from "@/lib/server/auth";
import { audit, clientIp, json, parseBody, rateLimit, route } from "@/lib/server/api";

const Body = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, "3–24 chars: a–z, 0–9, underscore"),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10, "At least 10 characters").max(200),
  // Optional: a blank field from the form means "not given" (it used to fail validation).
  displayName: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().min(1).max(50).optional()),
});

export const POST = route(async (req) => {
  const ip = clientIp(req);
  await rateLimit(`signup:${ip}`, 5, 3600);
  const b = await parseBody(req, Body);
  const clash = await prisma.user.findFirst({ where: { OR: [{ username: b.username }, { email: b.email }] }, select: { username: true } });
  if (clash) throw new HttpError(409, clash.username === b.username ? "Username is taken" : "Email already registered");
  const user = await prisma.user.create({
    data: { username: b.username, email: b.email, displayName: b.displayName ?? b.username, passwordHash: await hashPassword(b.password) },
  });
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
  await audit(user.id, "user.signup", "User", user.id, { method: "password" }, ip);
  return json({ ok: true, username: user.username }, { status: 201 });
});
