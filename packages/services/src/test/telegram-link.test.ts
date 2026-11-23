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

describe("Telegram linking to an existing community", () => {
  const { ctx } = makeCtx();
  beforeAll(resetDb);
  afterAll(() => prisma.$disconnect());
  const yes = async () => true;

  it("connects the group to the chosen community and announces its live challenges once", async () => {
    const owner = await makeUser("own2", { telegramId: 9001n });
    const outsider = await makeUser("out2", { telegramId: 9002n });
    const cat = await prisma.category.findFirstOrThrow();
    const community = await prisma.community.create({ data: { slug: "good-or-nah", name: "good or nah", creatorId: owner.id, members: { create: { userId: owner.id, role: "OWNER" } } } });
    const base = { description: "d", rules: "r", successCriteria: "20 sessions", successRule: { type: "milestone", minCompleters: 1 }, evidenceReq: "e", creatorId: owner.id, categoryId: cat.id, communityId: community.id, startDate: new Date(Date.now() + 3600e3), endDate: new Date(Date.now() + 30 * 86400e3) };
    const live = await prisma.challenge.create({ data: { ...base, slug: "gym-20", title: "20 gym sessions in 30 days", status: "UPCOMING" } });
    await prisma.challenge.create({ data: { ...base, slug: "secret", title: "Private one", status: "ACTIVE", visibility: "PRIVATE" } });
    await prisma.challenge.create({ data: { ...base, slug: "draft", title: "Draft one", status: "DRAFT" } });

    // A non-admin of the community can't use a code pointing at it.
    await prisma.telegramLinkCode.create({ data: { code: "grp-out-1", purpose: "LINK_GROUP", userId: outsider.id, communityId: community.id, expiresAt: new Date(Date.now() + 600e3) } });
    await expect(linkTelegramGroup(ctx, { code: "grp-out-1", chatId: -200, chatTitle: "good or nah", fromTelegramId: 9002, isChatAdmin: yes, botIsMember: yes })).rejects.toMatchObject({ status: 403 });

    await prisma.telegramLinkCode.create({ data: { code: "grp-own-1", purpose: "LINK_GROUP", userId: owner.id, communityId: community.id, expiresAt: new Date(Date.now() + 600e3) } });
    const linked = await linkTelegramGroup(ctx, { code: "grp-own-1", chatId: -200, chatTitle: "Good Or Nah 💪", fromTelegramId: 9001, isChatAdmin: yes, botIsMember: yes });
    expect(linked.id).toBe(community.id); // no duplicate community
    expect(linked.telegramChatId).toBe(-200n);
    expect(await prisma.community.count({ where: { name: { contains: "good or nah", mode: "insensitive" } } })).toBe(1);
    const queued = await prisma.telegramOutbox.findMany({ where: { chatId: -200n } });
    expect(queued.map((q) => q.dedupKey)).toEqual([`ANNOUNCE_NEW:${live.id}`]); // private + draft not announced

    // Re-linking the same group doesn't queue the announcement again.
    await unlinkTelegramGroup(ctx, -200);
    await prisma.telegramLinkCode.create({ data: { code: "grp-own-2", purpose: "LINK_GROUP", userId: owner.id, communityId: community.id, expiresAt: new Date(Date.now() + 600e3) } });
    await linkTelegramGroup(ctx, { code: "grp-own-2", chatId: -200, chatTitle: "good or nah", fromTelegramId: 9001, isChatAdmin: yes, botIsMember: yes });
    expect(await prisma.telegramOutbox.count({ where: { chatId: -200n } })).toBe(1);

    // A group already connected elsewhere can't be attached to a second community.
    const other = await prisma.community.create({ data: { slug: "other", name: "Other", creatorId: owner.id, members: { create: { userId: owner.id, role: "OWNER" } } } });
    await prisma.telegramLinkCode.create({ data: { code: "grp-own-3", purpose: "LINK_GROUP", userId: owner.id, communityId: other.id, expiresAt: new Date(Date.now() + 600e3) } });
    await expect(linkTelegramGroup(ctx, { code: "grp-own-3", chatId: -200, chatTitle: "x", fromTelegramId: 9001, isChatAdmin: yes, botIsMember: yes })).rejects.toMatchObject({ status: 409 });
  });
});
