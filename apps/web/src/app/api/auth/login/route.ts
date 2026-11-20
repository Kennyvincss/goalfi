import { z } from "zod";
import { prisma } from "@goalfi/db";
import { createSession, HttpError, verifyPassword } from "@/lib/server/auth";
import { clientIp, json, parseBody, rateLimit, route } from "@/lib/server/api";

const Body = z.object({ identifier: z.string().trim().toLowerCase().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const ip = clientIp(req);
  const b = await parseBody(req, Body);
  await rateLimit(`login:${ip}`, 20, 900);
  await rateLimit(`login-id:${b.identifier}`, 10, 900);
  const user = await prisma.user.findFirst({ where: { OR: [{ username: b.identifier }, { email: b.identifier }] } });
  // Same error for unknown user and wrong password.
  if (!user?.passwordHash || !(await verifyPassword(b.password, user.passwordHash))) throw new HttpError(401, "Invalid credentials");
  if (user.suspendedAt) throw new HttpError(403, "This account is suspended");
  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
  return json({ ok: true, username: user.username });
});
