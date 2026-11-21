import { z } from "zod";
import { prisma } from "@goalfi/db";
import { verifyWalletSignature, walletLinkMessage } from "@goalfi/chain";
import { HttpError, requireUser } from "@/lib/server/auth";
import { audit, clientIp, json, parseBody, rateLimit, route } from "@/lib/server/api";
import { linkDomain } from "@/lib/server/wallet";

const Body = z.object({ nonce: z.string().regex(/^[0-9a-f]{32}$/), signature: z.string().min(64).max(100) });

export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`wallet-link:${user.id}`, 10, 600);
  const b = await parseBody(req, Body);
  const n = await prisma.walletNonce.findUnique({ where: { nonce: b.nonce } });
  if (!n || n.userId !== user.id || n.usedAt || n.expiresAt < new Date()) throw new HttpError(400, "Nonce invalid or expired, try again");
  const message = walletLinkMessage({ domain: linkDomain(), wallet: n.wallet, nonce: n.nonce, issuedAt: n.createdAt.toISOString(), username: user.username });
  if (!verifyWalletSignature(message, b.signature, n.wallet)) throw new HttpError(401, "Signature does not match wallet");
  // Mark the nonce used atomically (prevents replay even under concurrency).
  const used = await prisma.walletNonce.updateMany({ where: { id: n.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new HttpError(400, "Nonce already used");
  const other = await prisma.user.findUnique({ where: { walletAddress: n.wallet }, select: { id: true } });
  if (other && other.id !== user.id) throw new HttpError(409, "This wallet is linked to another account");
  await prisma.user.update({ where: { id: user.id }, data: { walletAddress: n.wallet, walletLinkedAt: new Date() } });
  await audit(user.id, "user.wallet_linked", "User", user.id, { wallet: n.wallet }, clientIp(req));
  return json({ ok: true, wallet: n.wallet });
});

export const DELETE = route(async (req) => {
  const user = await requireUser();
  const pending = await prisma.transaction.count({ where: { userId: user.id, status: "PENDING" } });
  if (pending > 0) throw new HttpError(409, "Wait for pending transactions to confirm before unlinking");
  await prisma.user.update({ where: { id: user.id }, data: { walletAddress: null, walletLinkedAt: null } });
  await audit(user.id, "user.wallet_unlinked", "User", user.id, { wallet: user.walletAddress }, clientIp(req));
  return json({ ok: true });
});
