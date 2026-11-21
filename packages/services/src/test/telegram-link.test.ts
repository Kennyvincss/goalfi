import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import { linkTelegramAccount, linkTelegramGroup, migrateTelegramChat, unlinkTelegramGroup, joinCommunityByTelegram } from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

describe("Telegram linking", () => {
  const { ctx, advance } = makeCtx();
  beforeAll(resetDb);
  afterAll(() => prisma.$disconnect());

  const code = async (userId: string, purpose: "LINK_ACCOUNT" | "LINK_GROUP", c = Math.random().toString(36).slice(2, 18)) => {
    await prisma.telegramLinkCode.create({ data: { code: c, purpose, userId, expiresAt: new Date(ctx.now().getTime() + 30 * 60_000) } });
    return c;
  };

  it("links a Telegram account with a one-time code", async () => {
    const u = await makeUser("alice");
    const c = await code(u.id, "LINK_ACCOUNT");
    await expect(linkTelegramAccount(ctx, c, { id: 111, username: "alice_tg" })).resolves.toMatchObject({ telegramUsername: "alice_tg" });
    await expect(linkTelegramAccount(ctx, c, { id: 111 })).rejects.toThrow(/already used/);
    const other = await makeUser("mallory");
    await expect(linkTelegramAccount(ctx, await code(other.id, "LINK_ACCOUNT"), { id: 111 })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects expired and wrong-purpose codes", async () => {
    const u = await makeUser("bob");
    const c = await code(u.id, "LINK_GROUP");
    await expect(linkTelegramAccount(ctx, c, { id: 222 })).rejects.toThrow(/invalid/);
    const c2 = await code(u.id, "LINK_ACCOUNT");
    advance(31 * 60_000);
    await expect(linkTelegramAccount(ctx, c2, { id: 222 })).rejects.toThrow(/expired/);
  });

  it("links a group only for a verified group admin who owns the code", async () => {
    const owner = await makeUser("grp_owner", { telegramId: 333n });
    const yes = async () => true;
    const no = async () => false;
    const c1 = await code(owner.id, "LINK_GROUP");
    // Sender is not the Telegram account linked to the code's user.
    await expect(linkTelegramGroup(ctx, { code: c1, chatId: -1001, chatTitle: "Runners", fromTelegramId: 999, isChatAdmin: yes, botIsMember: yes })).rejects.toThrow(/Link your Telegram account/);
    // Sender is not a chat admin.
    await expect(linkTelegramGroup(ctx, { code: c1, chatId: -1001, chatTitle: "Runners", fromTelegramId: 333, isChatAdmin: no, botIsMember: yes })).rejects.toThrow(/administrators/);
    const community = await linkTelegramGroup(ctx, { code: c1, chatId: -1001, chatTitle: "Runners", fromTelegramId: 333, isChatAdmin: yes, botIsMember: yes });
    expect(community.telegramChatId).toBe(-1001n);
    expect(await prisma.communityMember.findFirst({ where: { communityId: community.id, userId: owner.id } })).toMatchObject({ role: "OWNER" });
    await expect(linkTelegramGroup(ctx, { code: c1, chatId: -1001, chatTitle: "Runners", fromTelegramId: 333, isChatAdmin: yes, botIsMember: yes })).rejects.toThrow(/already used/);
  });

  it("members join by Telegram; migration and removal keep the community", async () => {
    const member = await makeUser("member", { telegramId: 444n });
    expect(await joinCommunityByTelegram(ctx, -1001, 444)).toMatchObject({ userId: member.id, role: "MEMBER" });
    expect(await joinCommunityByTelegram(ctx, -1001, 55555)).toBeNull(); // unknown Telegram user
    await migrateTelegramChat(ctx, -1001, -1002);
    expect(await prisma.community.count({ where: { telegramChatId: -1002n } })).toBe(1);
    expect(await unlinkTelegramGroup(ctx, -1002)).toBe(1);
    expect(await prisma.community.count({ where: { name: "Runners" } })).toBe(1);
  });
});
