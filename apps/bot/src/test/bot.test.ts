import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GrammyError } from "grammy";
import type { Update } from "grammy/types";
import { prisma } from "@goalfi/db";
import type { ServiceContext } from "@goalfi/services";
import { createBot } from "../bot";
import { deliverNotifications, deliverOutbox } from "../dispatch";

const BOT_ID = 999000;
const botInfo = {
  id: BOT_ID, is_bot: true as const, first_name: "GoalFi", username: "GoalFiTestBot", can_join_groups: true, can_read_all_group_messages: false,
  supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false,
  can_manage_bots: false, supports_join_request_queries: false,
};
type Call = { method: string; payload: Record<string, unknown> };

const svc: ServiceContext = {
  db: prisma, gateway: null, appUrl: "https://goalfi.test", now: () => new Date(),
  storage: { put: async () => { throw new Error("unused"); }, get: async () => null },
};

describe("Telegram bot", () => {
  const calls: Call[] = [];
  const chatAdmins = new Set<number>();
  const blocked = new Set<number>();
  const bot = createBot("123:TEST", svc, { botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "getChatMember") {
      const uid = p.user_id as number;
      const status = uid === BOT_ID ? "member" : chatAdmins.has(uid) ? "administrator" : "member";
      return { ok: true, result: { status, user: { id: uid, is_bot: uid === BOT_ID, first_name: "x" } } } as never;
    }
    if (method === "sendMessage" && blocked.has(Number(p.chat_id)))
      return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } as never;
    return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: p.chat_id, type: "private" } } : true } as never;
  });

  let uid = 1000;
  const msg = (text: string, chat: { id: number; type: "private" | "supergroup"; title?: string }, fromId: number): Update => ({
    update_id: uid++,
    message: {
      message_id: uid, date: Math.floor(Date.now() / 1000), text, chat: chat as never, from: { id: fromId, is_bot: false, first_name: "U" },
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }],
    },
  });
  const lastReply = () => [...calls].reverse().find((c) => c.method === "sendMessage")?.payload.text as string;
  const GROUP = { id: -100777, type: "supergroup" as const, title: "Morning Runners" };

  let owner: { id: string }, verifier: { id: string }, runner: { id: string };
  beforeAll(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
    await prisma.category.create({ data: { slug: "fitness", name: "Fitness" } });
    owner = await prisma.user.create({ data: { username: "owner" } });
    verifier = await prisma.user.create({ data: { username: "verif", telegramId: 222n } });
    runner = await prisma.user.create({ data: { username: "runner", telegramId: 333n } });
  });
  beforeEach(() => { calls.length = 0; });
  afterAll(() => prisma.$disconnect());

  it("/start <code> in private links the Telegram account", async () => {
    await prisma.telegramLinkCode.create({ data: { code: "acct-code-0001", purpose: "LINK_ACCOUNT", userId: owner.id, expiresAt: new Date(Date.now() + 600_000) } });
    await bot.handleUpdate(msg("/start acct-code-0001", { id: 111, type: "private" }, 111));
    expect(lastReply()).toMatch(/Linked to GoalFi account/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).telegramId).toBe(111n);
    await bot.handleUpdate(msg("/start acct-code-0001", { id: 111, type: "private" }, 111));
    expect(lastReply()).toMatch(/already used/);
  });

  it("refuses to link a group for a non-admin, then links it for the admin", async () => {
    await prisma.telegramLinkCode.create({ data: { code: "grp-code-0001", purpose: "LINK_GROUP", userId: owner.id, expiresAt: new Date(Date.now() + 600_000) } });
    await bot.handleUpdate(msg("/start grp-code-0001", GROUP, 111));
    expect(lastReply()).toMatch(/Only group administrators/);
    expect(calls.filter((c) => c.method === "getChatMember").length).toBeGreaterThan(0);
    chatAdmins.add(111);
    await bot.handleUpdate(msg("/start grp-code-0001", GROUP, 111));
    expect(lastReply()).toMatch(/now connected/);
    const c = await prisma.community.findUniqueOrThrow({ where: { telegramChatId: BigInt(GROUP.id) } });
    expect(c.name).toBe("Morning Runners");
  });

  it("members /join, and commands read community data", async () => {
    await bot.handleUpdate(msg("/join", GROUP, 333));
    expect(lastReply()).toMatch(/member of this community/);
    await bot.handleUpdate(msg("/join", GROUP, 4444));
    expect(lastReply()).toMatch(/Link your Telegram account/);
    const community = await prisma.community.findUniqueOrThrow({ where: { telegramChatId: BigInt(GROUP.id) } });
    const cat = await prisma.category.findFirstOrThrow();
    await prisma.challenge.create({
      data: {
        slug: "run-100", title: "Run 100 km", description: "d", rules: "r", successCriteria: "s", successRule: { type: "milestone", minCompleters: 1 },
        evidenceReq: "e", creatorId: owner.id, categoryId: cat.id, communityId: community.id, status: "ACTIVE",
        startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 5 * 86_400_000), requiredApprovals: 1,
        roles: { create: [{ userId: owner.id, role: "ADMIN" }, { userId: verifier.id, role: "VERIFIER" }] },
        participants: { create: { userId: runner.id } },
      },
    });
    await bot.handleUpdate(msg("/challenges", GROUP, 333));
    expect(lastReply()).toMatch(/Run 100 km/);
    await bot.handleUpdate(msg("/markets", GROUP, 333));
    expect(lastReply()).toMatch(/No live markets/);
    await bot.handleUpdate(msg("/dashboard", { id: 333, type: "private" }, 333));
    expect(lastReply()).toMatch(/@runner/);
    await bot.handleUpdate(msg("/submit", { id: 333, type: "private" }, 333));
    expect(lastReply()).toMatch(/Pick a challenge/);
  });

  it("quick-approve callback goes through the same verification rules", async () => {
    const c = await prisma.challenge.findUniqueOrThrow({ where: { slug: "run-100" }, include: { participants: true } });
    const ev = await prisma.evidence.create({ data: { challengeId: c.id, participantId: c.participants[0]!.id, userId: runner.id, description: "ran", links: [], contentHash: "h" } });
    const cb = (fromId: number): Update => ({
      update_id: uid++,
      callback_query: { id: String(uid), chat_instance: "x", data: `rv:a:${ev.id}`, from: { id: fromId, is_bot: false, first_name: "V" },
        message: { message_id: 5, date: 0, chat: { id: fromId, type: "private", first_name: "V" } } as never },
    });
    await bot.handleUpdate(cb(333)); // the runner is not a verifier
    expect(calls.find((x) => x.method === "answerCallbackQuery")?.payload.text).toMatch(/not a verifier/);
    calls.length = 0;
    await bot.handleUpdate(cb(222));
    expect(calls.find((x) => x.method === "answerCallbackQuery")?.payload.text).toMatch(/Approved/);
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe("APPROVED");
  });

  it("dispatches notifications (with quick approve) and group announcements", async () => {
    const ev = await prisma.evidence.findFirstOrThrow();
    await prisma.notification.createMany({
      data: [
        { userId: verifier.id, type: "EVIDENCE_RECEIVED", message: "New evidence <b>", link: "https://goalfi.test/x", dedupKey: `EVIDENCE_RECEIVED:${ev.id}` },
        { userId: runner.id, type: "TRADE_CONFIRMED", message: "trade", dedupKey: "t1" },
        { userId: owner.id, type: "CHALLENGE_NEW", message: "no telegram? owner has one", dedupKey: "n1" },
      ],
    });
    blocked.add(111); // owner blocked the bot
    // 2 = the verifier's review request + the runner's "evidence approved" from the previous test.
    expect(await deliverNotifications(bot.api, svc)).toBe(2);
    const sent = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 222)!;
    expect(sent.payload.text).toBe("New evidence &lt;b&gt;");
    const kb = (sent.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard;
    expect(kb[0]![0]!.callback_data).toBe(`rv:a:${ev.id}`);
    // All three processed: sent / default-off (trade) / permanently undeliverable (blocked).
    expect(await prisma.notification.count({ where: { telegramSentAt: null } })).toBe(0);

    await prisma.telegramOutbox.create({ data: { chatId: BigInt(GROUP.id), text: "🎯 New challenge", buttons: [{ text: "View", url: "https://goalfi.test/c" }], dedupKey: "a1" } });
    expect(await deliverOutbox(bot.api, svc)).toBe(1);
    expect((await prisma.telegramOutbox.findUniqueOrThrow({ where: { dedupKey: "a1" } })).sentAt).not.toBeNull();
    expect(GrammyError).toBeDefined();
  });

  it("unlinks the community when the bot is removed", async () => {
    await bot.handleUpdate({
      update_id: uid++,
      my_chat_member: {
        chat: GROUP as never, from: { id: 111, is_bot: false, first_name: "O" }, date: 0,
        old_chat_member: { status: "member", user: { id: BOT_ID, is_bot: true, first_name: "GoalFi" } },
        new_chat_member: { status: "kicked", until_date: 0, user: { id: BOT_ID, is_bot: true, first_name: "GoalFi" } },
      },
    });
    expect(await prisma.community.count({ where: { telegramChatId: BigInt(GROUP.id) } })).toBe(0);
    expect(await prisma.community.count({ where: { name: "Morning Runners" } })).toBe(1);
  });
});
