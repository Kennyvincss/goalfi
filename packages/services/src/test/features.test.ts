import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  accountsConfigFromEnv,
  accountsTick,
  autoSettleTick,
  confirmChallenge,
  connectAccount,
  createChallenge,
  isoWeek,
  joinChallenge,
  lifecycleTick,
  parseOura,
  parseWithingsActivities,
  recentDaily,
  reviewEvidence,
  snapshotMarket,
  startConnect,
  submitEvidence,
  weeklyIdeasTick,
  type Actor,
  type Fetch,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const png = (s: string) => ({ name: `${s}.png`, mimeType: "image/png", bytes: new TextEncoder().encode(`png-${s}`) });

const cfg = accountsConfigFromEnv("https://goalfi.test", {
  ACCOUNT_TOKEN_KEY: "test-token-key-0123456789abcdefghijklmnop",
  WITHINGS_CLIENT_ID: "w-client", WITHINGS_CLIENT_SECRET: "w-secret",
  OURA_CLIENT_ID: "o-client", OURA_CLIENT_SECRET: "o-secret",
  TELEGRAM_BOT_TOKEN: "123:abc",
})!;

describe("Withings and Oura parsing", () => {
  it("Withings: tracker data only; several devices on a day → the larger value; distance in km", () => {
    const rows = parseWithingsActivities([
      { date: "2026-11-20", steps: 9000, distance: 6500, is_tracker: true },
      { date: "2026-11-20", steps: 4000, distance: 2000, is_tracker: true }, // second device
      { date: "2026-11-20", steps: 30000, distance: 20000, is_tracker: false }, // phone: ignored
      { date: "2026-11-21", steps: 7000, distance: null, is_tracker: true },
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      { metric: "steps", date: "2026-11-20", value: 9000 }, { metric: "distance_km", date: "2026-11-20", value: 6.5 },
      { metric: "steps", date: "2026-11-21", value: 7000 },
    ]));
    expect(rows).toHaveLength(3);
  });
  it("Oura: steps, workouts (manual ones ignored), runs and main-sleep wake time", () => {
    const rows = parseOura({
      activity: [{ day: "2026-11-20", steps: 11000 }, { day: "2026-11-21", steps: 4000 }],
      workouts: [
        { day: "2026-11-20", activity: "running", distance: 5200, source: "autodetected", start_datetime: "2026-11-20T07:00:00+01:00", end_datetime: "2026-11-20T07:30:00+01:00" },
        { day: "2026-11-20", activity: "walking", distance: 3000, source: "confirmed", start_datetime: "2026-11-20T12:00:00+01:00", end_datetime: "2026-11-20T12:40:00+01:00" },
        { day: "2026-11-21", activity: "running", distance: 10000, source: "manual", start_datetime: "2026-11-21T07:00:00+01:00", end_datetime: "2026-11-21T08:00:00+01:00" },
      ],
      sleep: [
        { day: "2026-11-21", type: "long_sleep", bedtime_end: "2026-11-21T06:40:00+01:00" },
        { day: "2026-11-21", type: "late_nap", bedtime_end: "2026-11-21T15:00:00+01:00" },
      ],
    });
    const get = (metric: string, date: string) => rows.find((r) => r.metric === metric && r.date === date)?.value;
    expect(get("steps", "2026-11-20")).toBe(11000);
    expect(get("workouts", "2026-11-20")).toBe(2);
    expect(get("running_km", "2026-11-20")).toBe(5.2);
    expect(get("running_km", "2026-11-21")).toBe(0); // the 10 km run was logged by hand
    expect(get("wake_time", "2026-11-21")).toBe(400); // 06:40 local
  });
});

describe("new features", () => {
  const t0 = new Date(Date.UTC(2026, 10, 25, 6)); // Wednesday 06:00 UTC
  const { ctx, gateway, clock, advance } = makeCtx(t0);
  let admin: Actor, verifier: Actor, ann: Actor, ben: Actor, cat: Actor;
  const today = iso(t0);
  const dayStart = new Date(`${today}T00:00:00Z`);
  const data = { withings: {} as Record<string, { date: string; steps: number; is_tracker: boolean }[]>, oura: {} as Record<string, Record<string, unknown[]>>, telegram: 40 };
  const tokens = new Map<string, string>();
  const f: Fetch = async (url, init) => {
    const u = new URL(String(url));
    const who = tokens.get(String((init?.headers as Record<string, string> | undefined)?.authorization ?? "").replace("Bearer ", ""));
    if (u.host === "wbsapi.withings.net" && u.pathname === "/v2/oauth2") {
      const p = new URLSearchParams(String(init?.body));
      const user = (p.get("code") ?? p.get("refresh_token") ?? "").replace(/^(wc|wr)-/, "");
      tokens.set(`wt-${user}`, user);
      return reply(200, { status: 0, body: { access_token: `wt-${user}`, refresh_token: `wr-${user}`, expires_in: 10800, scope: "user.activity", userid: `wid-${user}` } });
    }
    if (u.host === "wbsapi.withings.net" && u.pathname === "/v2/measure") {
      if (!who) return reply(200, { status: 401, error: "invalid_token" });
      return reply(200, { status: 0, body: { activities: data.withings[who] ?? [], more: false, offset: 0 } });
    }
    if (u.host === "api.ouraring.com" && u.pathname === "/oauth/token") {
      const p = new URLSearchParams(String(init?.body));
      const user = (p.get("code") ?? "").replace(/^oc-/, "");
      tokens.set(`ot-${user}`, user);
      return reply(200, { token_type: "bearer", access_token: `ot-${user}`, refresh_token: `or-${user}`, expires_in: 86400 });
    }
    if (u.host === "api.ouraring.com" && u.pathname === "/v2/usercollection/personal_info") return who ? reply(200, { id: `oid-${who}` }) : reply(401, {});
    if (u.host === "api.ouraring.com" && u.pathname.startsWith("/v2/usercollection/")) {
      if (!who) return reply(401, { detail: "unauthorized" });
      return reply(200, { data: data.oura[who]?.[u.pathname.split("/").at(-1)!] ?? [], next_token: null });
    }
    if (u.host === "api.telegram.org") return reply(200, { ok: true, result: data.telegram });
    return reply(404, { error: `unexpected ${url}` });
  };

  beforeAll(async () => {
    await resetDb();
    admin = await makeUser("nfadm");
    verifier = await makeUser("nfver");
    [ann, ben, cat] = (await Promise.all(["nfa", "nfb", "nfc"].map((n) => makeUser(n)))) as [Actor, Actor, Actor];
  });
  afterAll(() => prisma.$disconnect());

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Two of us walk 10k", description: "Two participants each walk 10,000 steps today.", categorySlug: "fitness",
    rules: "Steps from connected accounts, or proof.", successCriteria: "At least 2 participants record 10,000 steps.",
    successRule: { type: "individual_threshold", unit: "steps", threshold: 10_000, minParticipants: 2 },
    evidenceReq: "Screenshot of the day's steps", kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: dayStart, endDate: new Date(dayStart.getTime() + DAY),
    requiredApprovals: 1, disputeWindowHours: 1, verifierUsernames: [verifier.username], adminUsernames: [],
    verification: "HYBRID", app: { metric: "steps" }, autoSettle: true, reviewDeadlineHours: 24,
    marketQuestion: "Will two of us walk 10k?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 10 },
    ...over,
  });
  async function launch(over: Record<string, unknown> = {}) {
    const c = await createChallenge(ctx, admin, input(over));
    await confirmChallenge(ctx, admin, c.id);
    const m = await prisma.market.findUnique({ where: { challengeId: c.id } });
    if (m) await prisma.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    return c;
  }

  it("connects Withings and Oura; the same day from two sources counts once (the higher value)", async () => {
    const w = new URL(startConnect(cfg, "WITHINGS", "s1").url);
    expect([w.host, w.pathname, w.searchParams.get("scope")]).toEqual(["account.withings.com", "/oauth2_user/authorize2", "user.activity"]);
    expect(new URL(startConnect(cfg, "OURA", "s2").url).host).toBe("cloud.ouraring.com");
    data.withings[ann.username] = [{ date: today, steps: 7000, is_tracker: true }];
    data.oura[ann.username] = { daily_activity: [{ day: today, steps: 9000 }] };
    await connectAccount(ctx, ann, cfg, "WITHINGS", `wc-${ann.username}`, undefined, f);
    await connectAccount(ctx, ann, cfg, "OURA", `oc-${ann.username}`, undefined, f);
    expect(await prisma.connectedAccount.findMany({ where: { userId: ann.id }, select: { provider: true, externalId: true }, orderBy: { provider: "asc" } }))
      .toEqual([{ provider: "WITHINGS", externalId: `wid-${ann.username}` }, { provider: "OURA", externalId: `oid-${ann.username}` }]);
    expect(await recentDaily(ctx, ann.id, "steps")).toEqual([{ date: today, value: 9000 }]);
  });

  it("watch or proof: anyone joins; connected people sync, others upload proof that verifiers approve", async () => {
    const c = await launch();
    await joinChallenge(ctx, ann, c.id); // connected (Withings + Oura)
    await joinChallenge(ctx, ben, c.id); // no account: allowed in "watch or proof"
    // Connected participants can't upload (no double counting).
    await expect(submitEvidence(ctx, ann, c.id, { description: "steps", progressValue: 20000 }, [png("a")])).rejects.toMatchObject({ status: 409 });
    const proof = await submitEvidence(ctx, ben, c.id, { description: "Screenshot: 10,400 steps", progressValue: 10400 }, [png("b")]);
    await reviewEvidence(ctx, verifier, proof.id, { decision: "APPROVE" });

    data.oura[ann.username] = { daily_activity: [{ day: today, steps: 10_500 }] };
    advance(11 * MIN);
    const tick = await accountsTick(ctx, cfg, f);
    expect(tick.notConnected).toBe(1); // ben is reminded he can connect or upload
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: ben.id, dedupKey: `CONNECT_ACCOUNT:${c.id}:${ben.id}` } })).message).toMatch(/or upload proof/);
    const annEv = await prisma.evidence.findMany({ where: { challengeId: c.id, userId: ann.id, supersededBy: null } });
    expect(annEv.map((e) => [Number(e.progressValue), e.description.includes("Oura")])).toEqual([[10_500, true]]);

    clock.now = new Date(c.endDate.getTime() + 3 * HOUR + MIN); // past the late-data grace and the dispute window
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).outcome).toBe("YES"); // one synced, one proven
  });

  it("hybrid daily goals: proof must show the day's target was met", async () => {
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const c = await launch({
      title: "8k on 2 days", marketQuestion: "8k twice?", startDate: start, endDate: new Date(start.getTime() + 2 * DAY),
      successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 }, app: { metric: "steps", dailyTarget: 8000 },
    });
    await joinChallenge(ctx, cat, c.id);
    await expect(submitEvidence(ctx, cat, c.id, { description: "6k", progressValue: 6000, activityDate: iso(start) }, [png("c1")])).rejects.toMatchObject({ status: 422 });
    await expect(submitEvidence(ctx, cat, c.id, { description: "8.2k", progressValue: 8200, activityDate: iso(start) }, [png("c2")])).resolves.toBeTruthy();
  });

  it("validates watch or proof: needs verifiers, not for community size or wake-up time", async () => {
    await expect(createChallenge(ctx, admin, input({ verifierUsernames: [] }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ app: { metric: "wake_time", dailyTarget: 400 }, successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 } })))
      .rejects.toMatchObject({ status: 422 });
  });

  it("reminds participants who are short near the deadline, once", async () => {
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const c = await launch({
      title: "12k today", marketQuestion: "12k today?", verification: "CONNECTED_APP", verifierUsernames: [], reviewDeadlineHours: undefined,
      startDate: start, endDate: new Date(start.getTime() + DAY),
      successRule: { type: "individual_threshold", unit: "steps", threshold: 12_000, minParticipants: 1 },
    });
    await joinChallenge(ctx, ann, c.id);
    const d = iso(start);
    data.oura[ann.username] = { daily_activity: [{ day: d, steps: 8_000 }] };
    data.withings[ann.username] = [{ date: d, steps: 8_000, is_tracker: true }];
    clock.now = new Date(start.getTime() + 12 * HOUR); // 12h left: too early
    await accountsTick(ctx, cfg, f);
    expect(await prisma.notification.count({ where: { userId: ann.id, dedupKey: `SHORT:${c.id}:${ann.id}` } })).toBe(0);
    clock.now = new Date(start.getTime() + 21 * HOUR + 30 * MIN); // 2.5h left, 4,000 short
    expect((await accountsTick(ctx, cfg, f)).reminders).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: ann.id, dedupKey: `SHORT:${c.id}:${ann.id}` } });
    expect(n.message).toMatch(/at 8,000 of 12,000 steps, 4,000 to go/);
    advance(20 * MIN);
    expect((await accountsTick(ctx, cfg, f)).reminders).toBe(0); // once only
  });

  it("alerts holders and participants when the price moves 15+ points", async () => {
    const c = await launch({ title: "Price mover", marketQuestion: "Price mover?", startDate: clock.now, endDate: new Date(clock.now.getTime() + DAY) });
    await joinChallenge(ctx, ben, c.id);
    const m = await prisma.market.findUniqueOrThrow({ where: { challengeId: c.id } });
    await prisma.position.create({ data: { userId: cat.id, marketId: m.id, outcome: 1, amount: 5_000_000n, sharesBought: 9_000_000n } });
    gateway.setPool(m.marketAddress!, 0.4, 50_000_000);
    await snapshotMarket(ctx, m.id); // first price: baseline, no alert
    gateway.setPool(m.marketAddress!, 0.5, 50_000_000);
    await snapshotMarket(ctx, m.id); // +10 points: no alert
    expect(await prisma.notification.count({ where: { dedupKey: { startsWith: `PRICE:${m.id}` } } })).toBe(0);
    gateway.setPool(m.marketAddress!, 0.62, 50_000_000);
    await snapshotMarket(ctx, m.id); // +22 points from 40%
    const alerts = await prisma.notification.findMany({ where: { dedupKey: { startsWith: `PRICE:${m.id}` } } });
    expect(alerts.map((a) => a.userId).sort()).toEqual([ben.id, cat.id].sort());
    expect(alerts[0]!.message).toMatch(/YES moved from 40% to 62%/);
  });

  it("posts three challenge ideas to linked Telegram groups once a week (unless turned off)", async () => {
    const on = await prisma.community.create({ data: { slug: `on-${Date.now()}`, name: "Runners", creatorId: admin.id, telegramChatId: -100111n } });
    await prisma.community.create({ data: { slug: `off-${Date.now()}`, name: "Quiet", creatorId: admin.id, telegramChatId: -100222n, weeklyIdeas: false } });
    clock.now = new Date(Date.UTC(2026, 10, 30, 9)); // Monday 09:00 UTC: before posting time
    expect(await weeklyIdeasTick(ctx, cfg, f)).toBe(0);
    clock.now = new Date(Date.UTC(2026, 10, 30, 10, 5));
    expect(await weeklyIdeasTick(ctx, cfg, f)).toBe(1);
    expect(await weeklyIdeasTick(ctx, cfg, f)).toBe(0); // once per week
    const post = await prisma.telegramOutbox.findFirstOrThrow({ where: { chatId: -100111n } });
    expect(post.dedupKey).toBe(`IDEAS:${on.id}:${isoWeek(clock.now)}`);
    expect(post.text).toMatch(/^💡 Challenge ideas for Runners this week:/);
    expect(post.text.split("\n").filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    const buttons = post.buttons as { text: string; url: string }[];
    expect(buttons.filter((b) => b.url.includes("/challenges/new?"))).toHaveLength(3);
    expect(buttons.some((b) => b.url.includes(`community=${on.id}`))).toBe(true);
    clock.now = new Date(Date.UTC(2026, 11, 7, 11)); // next Monday
    expect(await weeklyIdeasTick(ctx, cfg, f)).toBe(1);
  });
});
