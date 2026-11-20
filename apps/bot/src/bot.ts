import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { prisma } from "@goalfi/db";
import {
  joinCommunityByTelegram,
  linkTelegramAccount,
  linkTelegramGroup,
  migrateTelegramChat,
  reviewEvidence,
  ServiceError,
  unlinkTelegramGroup,
  type Actor,
  type ServiceContext,
} from "@goalfi/services";
import { esc, priceLine, timeLeft } from "./format";

const HELP = [
  "<b>GoalFi</b> turns real-life goals into community challenges and prediction markets.",
  "",
  "/dashboard: your stats and active challenges",
  "/challenges: challenges here (or yours, in private)",
  "/markets: live markets and prices",
  "/leaderboard: rankings",
  "/submit: submit evidence (opens the website)",
  "/join: join this group’s GoalFi community",
  "/help: this message",
].join("\n");

const isGroup = (ctx: Context) => ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

async function userByTelegram(tgId: number | undefined): Promise<Actor | null> {
  if (!tgId) return null;
  const u = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
  if (!u || u.suspendedAt) return null;
  return { id: u.id, username: u.username, role: u.role, walletAddress: u.walletAddress };
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  console.error("[bot]", e);
  return "Something went wrong. Please try again later.";
}

export function createBot(token: string, svc: ServiceContext, opts: { botInfo?: UserFromGetMe } = {}) {
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const url = (path: string) => new URL(path, svc.appUrl).toString();
  const linkHint = () => new InlineKeyboard().url("Link Telegram on GoalFi", url("/settings#telegram"));

  // ── /start (private: account link / welcome; group: group link) ──
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (isGroup(ctx)) {
      if (!payload) return void (await ctx.reply("To connect this group, use “Add GoalFi to Telegram” on the GoalFi website.", { reply_markup: new InlineKeyboard().url("Open GoalFi", url("/telegram")) }));
      try {
        const chatId = ctx.chat.id;
        const community = await linkTelegramGroup(svc, {
          code: payload,
          chatId,
          chatTitle: ("title" in ctx.chat ? ctx.chat.title : undefined) ?? "Telegram group",
          fromTelegramId: ctx.from!.id,
          isChatAdmin: async (uid) => ["creator", "administrator"].includes((await ctx.api.getChatMember(chatId, uid)).status),
          botIsMember: async () => ["member", "administrator"].includes((await ctx.api.getChatMember(chatId, ctx.me.id)).status),
        });
        await ctx.reply(`✅ This group is now connected to the GoalFi community <b>${esc(community.name)}</b>.\n\nNew challenges, reminders and results will be posted here. Members can type /join.`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().url("Open community", url(`/communities/${community.slug}`)),
        });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(errText(e))}`, { parse_mode: "HTML", reply_markup: linkHint() });
      }
      return;
    }
    if (payload) {
      try {
        const user = await linkTelegramAccount(svc, payload, { id: ctx.from!.id, username: ctx.from!.username });
        await ctx.reply(`✅ Linked to GoalFi account <b>@${esc(user.username)}</b>. You’ll get reminders and review requests here.\n\n${HELP}`, { parse_mode: "HTML" });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(errText(e))}`, { parse_mode: "HTML" });
      }
      return;
    }
    const user = await userByTelegram(ctx.from?.id);
    await ctx.reply(user ? `👋 Welcome back, @${esc(user.username)}!\n\n${HELP}` : `👋 Welcome to GoalFi!\n\nLink your account to get reminders and review requests.\n\n${HELP}`, {
      parse_mode: "HTML",
      reply_markup: user ? new InlineKeyboard().url("Open dashboard", url("/dashboard")) : linkHint(),
    });
  });

  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("join", async (ctx) => {
    if (!isGroup(ctx)) return void (await ctx.reply("Use /join inside a connected group."));
    const m = await joinCommunityByTelegram(svc, ctx.chat.id, ctx.from!.id);
    await ctx.reply(m ? "✅ You’re a member of this community on GoalFi." : "Link your Telegram account to GoalFi first, or ask an admin to connect this group.", { reply_markup: m ? undefined : linkHint() });
  });

  bot.command("dashboard", async (ctx) => {
    const user = await userByTelegram(ctx.from?.id);
    if (!user) return void (await ctx.reply("Link your Telegram account to GoalFi first.", { reply_markup: linkHint() }));
    const [u, active] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { reputationScore: true, _count: { select: { participations: true } } } }),
      prisma.challenge.findMany({ where: { participants: { some: { userId: user.id, status: "JOINED" } }, status: { in: ["ACTIVE", "UPCOMING", "IN_REVIEW"] } }, orderBy: { endDate: "asc" }, take: 5 }),
    ]);
    const lines = active.map((c) => `• <a href="${url(`/challenges/${c.slug}`)}">${esc(c.title)}</a> (${timeLeft(c.endDate)})`);
    await ctx.reply([`<b>@${esc(user.username)}</b> · ⭐ ${u.reputationScore} reputation · ${u._count.participations} joined`, "", lines.length ? "<b>Active challenges</b>" : "No active challenges.", ...lines].join("\n"), {
      parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: new InlineKeyboard().url("Open dashboard", url("/dashboard")),
    });
  });

  async function communityOf(ctx: Context) {
    if (!isGroup(ctx)) return null;
    return prisma.community.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
  }

  bot.command("challenges", async (ctx) => {
    const community = await communityOf(ctx);
    if (isGroup(ctx) && !community) return void (await ctx.reply("This group isn’t connected to GoalFi yet.", { reply_markup: new InlineKeyboard().url("Connect", url("/telegram")) }));
    const user = community ? null : await userByTelegram(ctx.from?.id);
    if (!community && !user) return void (await ctx.reply("Link your Telegram account to see your challenges.", { reply_markup: linkHint() }));
    const list = await prisma.challenge.findMany({
      where: community
        ? { communityId: community.id, status: { in: ["ACTIVE", "UPCOMING", "IN_REVIEW"] }, visibility: { not: "PRIVATE" } }
        : { participants: { some: { userId: user!.id } }, status: { in: ["ACTIVE", "UPCOMING", "IN_REVIEW"] } },
      orderBy: { endDate: "asc" }, take: 10, include: { _count: { select: { participants: true } } },
    });
    if (!list.length) return void (await ctx.reply("No active challenges.", { reply_markup: new InlineKeyboard().url("Create one", url("/challenges/new")) }));
    await ctx.reply(
      ["<b>Active challenges</b>", ...list.map((c) => `• <a href="${url(`/challenges/${c.slug}`)}">${esc(c.title)}</a>: ${c._count.participants} joined, ${timeLeft(c.endDate)}`)].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("markets", async (ctx) => {
    const community = await communityOf(ctx);
    const markets = await prisma.market.findMany({
      where: { status: "OPEN", challenge: { visibility: "PUBLIC", ...(community ? { communityId: community.id } : {}) } },
      orderBy: { liquidity: "desc" }, take: 8,
      include: { challenge: { select: { slug: true, title: true, endDate: true } }, snapshots: { orderBy: { takenAt: "desc" }, take: 1 } },
    });
    if (!markets.length) return void (await ctx.reply("No live markets right now.", { reply_markup: new InlineKeyboard().url("Browse markets", url("/markets")) }));
    await ctx.reply(
      ["📈 <b>Live markets</b>", ...markets.map((m) => `• <a href="${url(`/challenges/${m.challenge.slug}`)}">${esc(m.challenge.title)}</a>\n   ${priceLine(m.snapshots[0]?.yesPrice)} · ${timeLeft(m.challenge.endDate)}`)].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: new InlineKeyboard().url("Trade on GoalFi", url("/markets")) },
    );
  });

  bot.command("leaderboard", async (ctx) => {
    const community = await communityOf(ctx);
    const top = await prisma.user.findMany({
      where: { reputationScore: { gt: 0 }, suspendedAt: null, ...(community ? { memberships: { some: { communityId: community.id } } } : {}) },
      orderBy: { reputationScore: "desc" }, take: 10, select: { username: true, reputationScore: true },
    });
    if (!top.length) return void (await ctx.reply("No rankings yet. Complete challenges to earn reputation!"));
    await ctx.reply([`🏆 <b>${community ? esc(community.name) : "Global"} leaderboard</b>`, ...top.map((u, i) => `${i + 1}. @${esc(u.username)}: ${u.reputationScore} pts`)].join("\n"), { parse_mode: "HTML" });
  });

  bot.command("submit", async (ctx) => {
    const user = await userByTelegram(ctx.from?.id);
    if (!user) return void (await ctx.reply("Link your Telegram account to GoalFi first.", { reply_markup: linkHint() }));
    const list = await prisma.challenge.findMany({ where: { participants: { some: { userId: user.id, status: "JOINED" } }, status: { in: ["ACTIVE", "IN_REVIEW"] } }, take: 8, orderBy: { endDate: "asc" } });
    if (!list.length) return void (await ctx.reply("You have no challenges accepting evidence right now."));
    const kb = new InlineKeyboard();
    for (const c of list) kb.url(`📤 ${c.title.slice(0, 40)}`, url(`/challenges/${c.slug}`)).row();
    await ctx.reply("Evidence is uploaded on the website (files are hashed and locked). Pick a challenge:", { reply_markup: kb });
  });

  // ── Quick review action from a verifier's notification ──
  bot.callbackQuery(/^rv:a:([a-z0-9]{20,40})$/, async (ctx) => {
    const user = await userByTelegram(ctx.from.id);
    if (!user) return void (await ctx.answerCallbackQuery({ text: "Link your Telegram account to GoalFi first.", show_alert: true }));
    try {
      const r = await reviewEvidence(svc, user, ctx.match[1]!, { decision: "APPROVE" });
      await ctx.answerCallbackQuery({ text: r.status === "APPROVED" ? "Approved: threshold reached ✅" : `Approval recorded (${r.approvals} so far)` });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: errText(e), show_alert: true });
    }
  });

  // ── Membership changes ──
  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "left" || status === "kicked") await unlinkTelegramGroup(svc, ctx.chat.id);
  });
  bot.on("message:migrate_to_chat_id", async (ctx) => {
    await migrateTelegramChat(svc, ctx.chat.id, ctx.message.migrate_to_chat_id);
  });

  bot.catch((err) => console.error("[bot] update failed:", err.error));
  return bot;
}
