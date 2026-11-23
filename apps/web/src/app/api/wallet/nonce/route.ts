import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@goalfi/db";
import { walletLinkMessage } from "@goalfi/chain";
import { HttpError, requireUser } from "@/lib/server/auth";
import { json, parseBody, rateLimit, route } from "@/lib/server/api";
import { linkDomain } from "@/lib/server/wallet";

const Body = z.object({ wallet: z.string().min(32).max(44) });

export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`wallet-nonce:${user.id}`, 10, 600);
  const { wallet } = await parseBody(req, Body);
  try {
    new PublicKey(wallet);
  } catch {
    throw new HttpError(422, "Invalid Solana address");
  }
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  await prisma.walletNonce.create({ data: { nonce, userId: user.id, wallet, expiresAt: new Date(issuedAt.getTime() + 10 * 60_000), createdAt: issuedAt } });
  const message = walletLinkMessage({ domain: linkDomain(), wallet, nonce, issuedAt: issuedAt.toISOString(), username: user.username });
  return json({ nonce, message });
});
