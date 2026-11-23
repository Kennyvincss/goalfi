import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  accountsConfigFromEnv,
  accountsTick,
  autoSettleTick,
  confirmChallenge,
  connectAccount,
  countWorkouts,
  createChallenge,
  disconnectAccount,
  joinChallenge,
  lifecycleTick,
  parseContributionCalendar,
  parseDailyRollup,
  recentDaily,
  startConnect,
  submitEvidence,
  systemResolutionReport,
  wakeTimes,
  GOOGLE_SLEEP_SCOPE,
  type Actor,
  type Fetch,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const civil = (date: string, h = 0, m = 0) => {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day }, time: { hours: h, minutes: m } };
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ndjson = (rows: unknown[]) => new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });

const cfg = accountsConfigFromEnv("https://goalfi.test", {
  ACCOUNT_TOKEN_KEY: "test-token-key-0123456789abcdefghijklmnop",
  GOOGLE_HEALTH_CLIENT_ID: "g-client", GOOGLE_HEALTH_CLIENT_SECRET: "g-secret",
  GITHUB_CLIENT_ID: "gh-client", GITHUB_CLIENT_SECRET: "gh-secret",
  TELEGRAM_BOT_TOKEN: "123:abc",
})!;

/**
 * Fake provider APIs, shaped like the official clients' types. `data` holds what each user's
 * account has recorded; tests change it to simulate new activity and late uploads.
 */
function fakeProviders() {
  const data = {
    steps: {} as Record<string, Record<string, number>>,
    workouts: {} as Record<string, { date: string; secs: number }[]>,
    sleeps: {} as Record<string, { end: string; h: number; m: number; main: boolean; nap?: boolean }[]>,
    contributions: {} as Record<string, Record<string, number>>,
    games: {} as Record<string, { id: string; at: number; status: string }[]>,
    puzzles: {} as Record<string, { id: string; at: number; win: boolean }[]>,
    telegramMembers: 0,
  };
  const tokens = new Map<string, string>(); // token → user
  const calls = { refresh: 0, revoke: 0, lichessVerifier: "" as string };
  let failWith: number | null = null;
  const user = (init?: RequestInit) => tokens.get(String((init?.headers as Record<string, string>)?.authorization ?? "").replace(/^Bearer /, ""));
  const f: Fetch = async (url, init) => {
    const u = new URL(String(url));
    const path = u.pathname;
    // ── Google ──
    if (u.host === "oauth2.googleapis.com" && path === "/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code") {
        const who = p.get("code")!.replace(/^g-/, "");
        tokens.set(`gat-${who}`, who);
        const scope = who.includes("nosleep") ? "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly" : `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly ${GOOGLE_SLEEP_SCOPE}`;
        return reply(200, { access_token: `gat-${who}`, refresh_token: `grt-${who}`, expires_in: 3600, scope });
      }
      calls.refresh++;
      const who = p.get("refresh_token")!.replace(/^grt-/, "");
      tokens.set(`gat-${who}-${calls.refresh}`, who);
      return reply(200, { access_token: `gat-${who}-${calls.refresh}`, expires_in: 3600 });
    }
    if (u.host === "oauth2.googleapis.com" && path === "/revoke") return calls.revoke++, reply(200, {});
    if (u.host === "health.googleapis.com") {
      if (failWith) return reply(failWith, { error: { code: failWith, message: "Request had invalid authentication credentials." } });
      const who = user(init);
      if (!who) return reply(401, { error: { code: 401 } });
      if (path.endsWith(":dailyRollUp")) {
        const body = JSON.parse(String(init?.body));
        const d = (c: { date: { year: number; month: number; day: number } }) => `${c.date.year}-${String(c.date.month).padStart(2, "0")}-${String(c.date.day).padStart(2, "0")}`;
        const [from, to] = [d(body.range.start), d(body.range.end)];
        const type = path.split("/").at(-2)!;
        const rows = Object.entries(data.steps[who] ?? {}).filter(([date]) => date >= from && date < to);
        const value = (v: number) =>
          type === "steps" ? { steps: { countSum: String(v) } }
          : type === "distance" ? { distance: { millimetersSum: String(Math.round(v * 760)) } } // 0.76 m per step
          : type === "floors" ? { floors: { countSum: String(Math.floor(v / 2000)) } }
          : { activeZoneMinutes: { sumInFatBurnHeartZone: String(Math.floor(v / 1000)), sumInCardioHeartZone: "2" } };
        return reply(200, { rollupDataPoints: rows.map(([date, v]) => ({ civilStartTime: civil(date), civilEndTime: civil(date, 23, 59), ...value(v) })) });
      }
      if (path.endsWith("/exercise/dataPoints"))
        return reply(200, { dataPoints: (data.workouts[who] ?? []).map((w) => ({ exercise: { exerciseType: "WEIGHTLIFTING", activeDuration: `${w.secs}s`, interval: { civilStartTime: civil(w.date, 18) } } })) });
      if (path.endsWith("/sleep/dataPoints")) {
        const filter = u.searchParams.get("filter") ?? "";
        const [, from, to] = /civil_end_time >= "([\d-]+)" AND sleep\.interval\.civil_end_time < "([\d-]+)"/.exec(filter) ?? [];
        return reply(200, {
          dataPoints: (data.sleeps[who] ?? []).filter((s) => s.end >= from! && s.end < to!).map((s) => ({
            sleep: {
              metadata: { mainSleep: s.main, nap: s.nap ?? false },
              interval: { civilEndTime: civil(s.end, s.h, s.m), startTime: `${s.end}T00:00:00Z`, endTime: `${s.end}T0${s.nap ? 1 : 7}:00:00Z` },
            },
          })),
        });
      }
    }
    // ── GitHub ──
    if (u.host === "github.com" && path === "/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body));
      if (body.code === "bad") return reply(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
      const who = String(body.code).replace(/^gh-/, "");
      tokens.set(`ght-${who}`, who);
      return reply(200, { access_token: `ght-${who}`, token_type: "bearer", scope: "" });
    }
    if (u.host === "api.github.com" && path === "/graphql") {
      const who = user(init);
      if (!who) return reply(401, { message: "Bad credentials" });
      const body = JSON.parse(String(init?.body));
      const login = who.replace("#", "");
      if (!body.variables) return reply(200, { data: { viewer: { login, databaseId: login.length * 1000 + login.charCodeAt(0) } } });
      const days = Object.entries(data.contributions[who] ?? {}).map(([date, n]) => ({ date, contributionCount: n }));
      return reply(200, { data: { viewer: { login, contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: days }] } } } } });
    }
    if (u.host === "api.github.com" && path.startsWith("/applications/")) return calls.revoke++, new Response(null, { status: 204 });
    // ── Lichess ──
    if (u.host === "lichess.org" && path === "/api/token" && init?.method === "POST") {
      const p = new URLSearchParams(String(init?.body));
      calls.lichessVerifier = p.get("code_verifier") ?? "";
      const who = p.get("code")!.replace(/^li-/, "");
      tokens.set(`lit-${who}`, who);
      return reply(200, { token_type: "Bearer", access_token: `lit-${who}`, expires_in: 31_536_000 });
    }
    if (u.host === "lichess.org" && path === "/api/token") return calls.revoke++, new Response(null, { status: 204 });
    if (u.host === "lichess.org" && path === "/api/account") {
      const who = user(init);
      return who ? reply(200, { id: who.toLowerCase(), username: who }) : reply(401, { error: "No such token" });
    }
    if (u.host === "lichess.org" && path.startsWith("/api/games/user/")) {
      const who = path.split("/").at(-1)!;
      const since = Number(u.searchParams.get("since")), until = Number(u.searchParams.get("until"));
      return ndjson((data.games[who] ?? []).filter((g) => g.at >= since && g.at <= until).map((g) => ({ id: g.id, rated: true, status: g.status, createdAt: g.at - 600_000, lastMoveAt: g.at })));
    }
    if (u.host === "lichess.org" && path === "/api/puzzle/activity") {
      const who = user(init)!.toLowerCase();
      const since = Number(u.searchParams.get("since"));
      return ndjson((data.puzzles[who] ?? []).filter((p) => p.at >= since).map((p) => ({ date: p.at, win: p.win, puzzle: { id: p.id, fen: "", lastMove: "", plays: 1, rating: 1500, solution: [], themes: [] } })));
    }
    // ── Telegram ──
    if (u.host === "api.telegram.org" && path.endsWith("/getChatMemberCount")) return reply(200, { ok: true, result: data.telegramMembers });
    return reply(404, { error: `unexpected ${url}` });
  };
  return { f, data, calls, fail: (s: number | null) => (failWith = s) };
}

describe("provider response parsing", () => {
  it("reads Google dailyRollUp values per metric", () => {
    const body = {
      rollupDataPoints: [
        { civilStartTime: civil("2026-11-03"), steps: { countSum: "12034" }, distance: { millimetersSum: "8125000" } },
        { civilStartTime: civil("2026-11-04"), steps: { countSum: 800 } },
        { civilStartTime: civil("2026-11-05"), steps: {} },
        { civilStartTime: {}, steps: { countSum: "5" } },
      ],
      nextPageToken: "p2",
    };
    expect(parseDailyRollup(body, "steps")).toEqual({ rows: [{ date: "2026-11-03", value: 12034 }, { date: "2026-11-04", value: 800 }], nextPageToken: "p2" });
    expect(parseDailyRollup(body, "distance_km").rows).toEqual([{ date: "2026-11-03", value: 8.13 }]);
  });
  it("counts workouts of 10+ minutes and picks the main sleep's wake time", () => {
    const w = countWorkouts([
      { exercise: { activeDuration: "1800s", interval: { civilStartTime: civil("2026-11-03", 7) } } },
      { exercise: { activeDuration: "300s", interval: { civilStartTime: civil("2026-11-03", 12) } } },
      { exercise: { interval: { civilStartTime: civil("2026-11-04", 7), startTime: "2026-11-04T07:00:00Z", endTime: "2026-11-04T07:45:00Z" } } },
    ]);
    expect([...w]).toEqual([["2026-11-03", 1], ["2026-11-04", 1]]);
    const s = wakeTimes([
      { sleep: { metadata: { mainSleep: true }, interval: { civilEndTime: civil("2026-11-03", 6, 40), startTime: "2026-11-02T23:00:00Z", endTime: "2026-11-03T06:40:00Z" } } },
      { sleep: { metadata: { nap: true }, interval: { civilEndTime: civil("2026-11-03", 15, 0) } } },
    ]);
    expect([...s]).toEqual([["2026-11-03", 400]]);
  });
  it("reads GitHub's contribution calendar", () => {
    const r = parseContributionCalendar({ data: { viewer: { login: "octo", contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: [{ date: "2026-11-03", contributionCount: 4 }, { date: "bad", contributionCount: 1 }] }] } } } } });
    expect(r).toEqual({ login: "octo", days: [{ date: "2026-11-03", value: 4 }] });
  });
});

describe("connected accounts", () => {
  // 06:00 UTC, so "today" and the challenge's whole UTC days line up.
  const t0 = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 6));
  const { ctx, gateway, clock, advance } = makeCtx(t0);
  const P = fakeProviders();
  let admin: Actor, p1: Actor, p2: Actor, p3: Actor, p4: Actor;
  const today = iso(t0), yesterday = iso(new Date(t0.getTime() - DAY)), tomorrow = iso(new Date(t0.getTime() + DAY));
  const dayStart = new Date(`${today}T00:00:00Z`);

  beforeAll(async () => {
    await resetDb();
    admin = await makeUser("fadm");
    [p1, p2, p3, p4] = (await Promise.all(["fa", "fb", "fc", "fd"].map((n) => makeUser(n)))) as [Actor, Actor, Actor, Actor];
  });
  afterAll(() => prisma.$disconnect());

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Two of us walk 15k", description: "Two participants each walk 15,000 steps over two days.", categorySlug: "fitness",
    rules: "Steps come from Google Health.", successCriteria: "At least 2 participants record 15,000 steps.",
    successRule: { type: "individual_threshold", unit: "steps", threshold: 15_000, minParticipants: 2 },
    evidenceReq: "Synced automatically", kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: dayStart, endDate: new Date(dayStart.getTime() + 2 * DAY),
    requiredApprovals: 1, disputeWindowHours: 1, verifierUsernames: [], adminUsernames: [],
    verification: "CONNECTED_APP", app: { metric: "steps" }, autoSettle: true,
    marketQuestion: "Will two of us walk 15k steps?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 10 },
    ...over,
  });
  async function launch(over: Record<string, unknown> = {}, by = admin) {
    const c = await createChallenge(ctx, by, input(over));
    await confirmChallenge(ctx, by, c.id);
    const m = await prisma.market.findUnique({ where: { challengeId: c.id } });
    if (m) await prisma.market.update({ where: { id: m.id }, data: { status: "OPEN" } });
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    return c;
  }
  const outcome = async (id: string) => (await prisma.challenge.findUniqueOrThrow({ where: { id } })).outcome;

  it("validates app-verified challenges", async () => {
    await expect(createChallenge(ctx, admin, input({ app: undefined }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "milestone", minCompleters: 1 } }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "individual_threshold", unit: "km", threshold: 5, minParticipants: 1 } }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 } }))).rejects.toMatchObject({ status: 422 });
  });

  it("Google: connecting stores encrypted tokens and pulls recent history for every metric", async () => {
    P.data.steps[p1.username] = { [yesterday]: 9000 };
    P.data.workouts[p1.username] = [{ date: yesterday, secs: 2400 }];
    P.data.sleeps[p1.username] = [{ end: yesterday, h: 6, m: 10, main: true }];
    await connectAccount(ctx, p1, cfg, "GOOGLE_HEALTH", `g-${p1.username}`, undefined, P.f);
    const a = await prisma.connectedAccount.findFirstOrThrow({ where: { userId: p1.id } });
    expect(a.status).toBe("ACTIVE");
    expect(a.accessTokenEnc).not.toContain(`gat-${p1.username}`);
    expect(a.refreshTokenEnc).not.toContain(`grt-${p1.username}`);
    expect(await recentDaily(ctx, p1.id, "steps")).toEqual([{ date: yesterday, value: 9000 }]);
    expect(await recentDaily(ctx, p1.id, "distance_km")).toEqual([{ date: yesterday, value: 6.84 }]);
    expect(await recentDaily(ctx, p1.id, "workouts")).toEqual([{ date: yesterday, value: 1 }]);
    expect(await recentDaily(ctx, p1.id, "wake_time")).toEqual([{ date: yesterday, value: 370 }]);
    P.data.steps[p2.username] = {};
    await connectAccount(ctx, p2, cfg, "GOOGLE_HEALTH", `g-${p2.username}`, undefined, P.f);
  });

  it("joining needs the right account; manual evidence is refused", async () => {
    const c = await launch();
    await expect(joinChallenge(ctx, p3, c.id)).rejects.toMatchObject({ status: 409 });
    await joinChallenge(ctx, p1, c.id);
    await joinChallenge(ctx, p2, c.id);
    await expect(submitEvidence(ctx, p1, c.id, { description: "20000 steps", progressValue: 20000 }, [])).rejects.toMatchObject({ status: 409 });
  });

  it("syncs into approved evidence, supersedes changed totals, and settles itself after the grace period", async () => {
    const c = await prisma.challenge.findFirstOrThrow({ where: { title: "Two of us walk 15k" } });
    P.data.steps[p1.username] = { [yesterday]: 9000, [today]: 7000 }; // yesterday is outside the challenge
    P.data.steps[p2.username] = { [today]: 4000 };
    advance(10 * MIN + 1);
    expect(await accountsTick(ctx, cfg, P.f)).toMatchObject({ challenges: 1, evidence: 2 });
    const ev1 = await prisma.evidence.findMany({ where: { challengeId: c.id, userId: p1.id } });
    expect(ev1).toHaveLength(1);
    expect(ev1[0]).toMatchObject({ status: "APPROVED", autoDecision: "CONNECTED_APP" });
    expect(Number(ev1[0]!.progressValue)).toBe(7000);

    expect((await accountsTick(ctx, cfg, P.f)).evidence).toBe(0); // unchanged → nothing new

    P.data.steps[p1.username]![today] = 8200;
    P.data.steps[p1.username]![tomorrow] = 8000;
    P.data.steps[p2.username] = { [today]: 4000, [tomorrow]: 6000 };
    advance(DAY); // day 2, 06:00 (access tokens expired → refreshed)
    expect(await accountsTick(ctx, cfg, P.f)).toMatchObject({ evidence: 3 });
    expect(P.calls.refresh).toBeGreaterThanOrEqual(2);
    const live = await prisma.evidence.findMany({ where: { challengeId: c.id, userId: p1.id, supersededBy: null } });
    expect(live.map((e) => Number(e.progressValue)).sort()).toEqual([8000, 8200]);
    const old = await prisma.evidence.findFirstOrThrow({ where: { challengeId: c.id, userId: p1.id, progressValue: 7000 } });
    expect(await prisma.evidence.count({ where: { supersedesId: old.id } })).toBe(1);

    advance(DAY - 6 * HOUR + MIN); // 00:01 after the last day
    await lifecycleTick(ctx);
    expect((await systemResolutionReport(ctx, c.id)).blockers.join(" ")).toMatch(/late fitness data/);
    P.data.steps[p2.username]![tomorrow] = 11_500; // late upload still counts
    advance(90 * MIN);
    await accountsTick(ctx, cfg, P.f);
    advance(31 * MIN); // past the 2h grace period
    expect((await accountsTick(ctx, cfg, P.f)).challenges).toBe(0);
    expect((await systemResolutionReport(ctx, c.id)).blockers.join(" ")).toMatch(/Dispute window/);
    advance(HOUR);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 1 });
    const done = await prisma.challenge.findUniqueOrThrow({ where: { id: c.id }, include: { market: true } });
    expect(done).toMatchObject({ status: "RESOLVED", outcome: "YES", resolvedById: null }); // 16,200 and 15,500
    expect(gateway.markets.get(done.market!.marketAddress!)?.winningSide).toBe("YES");
  });

  it("Google: workouts and wake-up time (lower is better, needs sleep access)", async () => {
    advance(DAY);
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const [d1, d2, d3] = [0, 1, 2].map((k) => iso(new Date(start.getTime() + k * DAY))) as [string, string, string];
    const wake = await launch({
      title: "Up by 6:30", marketQuestion: "Up by 6:30 twice?", startDate: start, endDate: new Date(start.getTime() + 3 * DAY), categorySlug: "fitness",
      successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 }, app: { metric: "wake_time", dailyTarget: 390 },
    });
    const gym = await launch({
      title: "Three workouts", marketQuestion: "Three workouts?", startDate: start, endDate: new Date(start.getTime() + 3 * DAY),
      successRule: { type: "individual_threshold", unit: "workouts", threshold: 3, minParticipants: 1 },
      app: { metric: "workouts" },
    });
    // An account connected without sleep permission can't join the wake-up challenge.
    await connectAccount(ctx, p4, cfg, "GOOGLE_HEALTH", `g-${p4.username}nosleep`, undefined, P.f);
    await expect(joinChallenge(ctx, p4, wake.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/sleep/) });
    await joinChallenge(ctx, p1, wake.id);
    await joinChallenge(ctx, p1, gym.id);
    P.data.steps[p1.username] = { [d1]: 5000, [d2]: 5000, [d3]: 5000 };
    P.data.sleeps[p1.username] = [
      { end: d1, h: 6, m: 20, main: true }, { end: d1, h: 15, m: 0, main: false, nap: true },
      { end: d2, h: 6, m: 45, main: true }, { end: d3, h: 6, m: 30, main: true },
    ];
    P.data.workouts[p1.username] = [{ date: d1, secs: 3600 }, { date: d1, secs: 120 }, { date: d2, secs: 1500 }, { date: d3, secs: 2000 }];
    clock.now = new Date(start.getTime() + 3 * DAY + HOUR);
    await accountsTick(ctx, cfg, P.f);
    const wakeEv = await prisma.evidence.findMany({ where: { challengeId: wake.id }, orderBy: { activityDate: "asc" } });
    expect(wakeEv.map((e) => [iso(e.activityDate!), Number(e.progressValue)])).toEqual([[d1, 380], [d3, 390]]); // 06:45 doesn't count
    expect(wakeEv[0]!.description).toMatch(/Woke up at 06:20/);
    advance(4 * HOUR);
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect(await outcome(wake.id)).toBe("YES");
    expect(await outcome(gym.id)).toBe("YES"); // 1 + 1 + 1 (the 2-minute one doesn't count)
  });

  it("GitHub: contributions per day; one GitHub account can't back two users", async () => {
    await expect(connectAccount(ctx, p2, cfg, "GITHUB", "bad", undefined, P.f)).rejects.toThrow(/incorrect or expired/);
    await connectAccount(ctx, p2, cfg, "GITHUB", "gh-octo", undefined, P.f);
    expect(await prisma.connectedAccount.findFirst({ where: { userId: p2.id, provider: "GITHUB" } })).toMatchObject({ externalName: "octo", status: "ACTIVE" });
    await expect(connectAccount(ctx, p3, cfg, "GITHUB", "gh-octo", undefined, P.f)).rejects.toMatchObject({ status: 409 });

    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const days = [0, 1, 2].map((k) => iso(new Date(start.getTime() + k * DAY)));
    const c = await launch({
      title: "Ship every day", marketQuestion: "Ship 3 days straight?", categorySlug: "fitness", startDate: start, endDate: new Date(start.getTime() + 3 * DAY),
      successRule: { type: "daily_completion", requiredDays: 3, minParticipants: 1 }, app: { metric: "github_contributions", dailyTarget: 2 },
    });
    await joinChallenge(ctx, p2, c.id);
    P.data.contributions.octo = { [days[0]!]: 5, [days[1]!]: 1, [days[2]!]: 3 };
    clock.now = new Date(start.getTime() + 3 * DAY + HOUR);
    await accountsTick(ctx, cfg, P.f);
    expect(await prisma.evidence.count({ where: { challengeId: c.id } })).toBe(2); // the 1-contribution day doesn't count
    advance(4 * HOUR);
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect(await outcome(c.id)).toBe("NO");
  });

  it("Lichess: PKCE sign-in; games and solved puzzles count per local challenge day", async () => {
    const { url, verifier } = startConnect(cfg, "LICHESS", "state123");
    const auth = new URL(url);
    expect(auth.host).toBe("lichess.org");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("client_id")).toBe("goalfi.test");
    expect(verifier).toBeTruthy();
    await connectAccount(ctx, p3, cfg, "LICHESS", "li-Magnus", verifier, P.f);
    expect(P.calls.lichessVerifier).toBe(verifier);
    expect(await prisma.connectedAccount.findFirst({ where: { userId: p3.id, provider: "LICHESS" } })).toMatchObject({ externalId: "magnus", externalName: "Magnus" });

    // A UTC+2 user: local midnight is 22:00 UTC the day before.
    const localMidnight = new Date(new Date(`${iso(new Date(clock.now.getTime() + DAY))}T00:00:00Z`).getTime() - 2 * HOUR);
    const c = await launch({
      title: "Five games in two days", marketQuestion: "Five games?", categorySlug: "fitness", startDate: localMidnight, endDate: new Date(localMidnight.getTime() + 2 * DAY),
      successRule: { type: "individual_threshold", unit: "chess games", threshold: 5, minParticipants: 1 }, app: { metric: "lichess_games" },
    });
    const p = await launch({
      title: "Puzzles daily", marketQuestion: "Puzzles daily?", categorySlug: "fitness", startDate: localMidnight, endDate: new Date(localMidnight.getTime() + 2 * DAY),
      successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 }, app: { metric: "lichess_puzzles", dailyTarget: 2 },
    });
    await joinChallenge(ctx, p3, c.id);
    await joinChallenge(ctx, p3, p.id);
    const t = localMidnight.getTime();
    P.data.games.magnus = [
      { id: "before", at: t - HOUR, status: "mate" }, // the evening before (local): outside
      { id: "g1", at: t + HOUR, status: "resign" }, { id: "g2", at: t + 2 * HOUR, status: "aborted" },
      { id: "g3", at: t + 23 * HOUR, status: "outoftime" }, // 21:00 UTC = 23:00 local, still day 1
      { id: "g4", at: t + 30 * HOUR, status: "draw" }, { id: "g5", at: t + 31 * HOUR, status: "mate" }, { id: "g6", at: t + 32 * HOUR, status: "started" },
    ];
    P.data.puzzles.magnus = [
      { id: "p1", at: t + HOUR, win: true }, { id: "p2", at: t + 2 * HOUR, win: true }, { id: "p3", at: t + 3 * HOUR, win: false },
      { id: "p4", at: t + 25 * HOUR, win: true }, { id: "p5", at: t + 26 * HOUR, win: false },
    ];
    clock.now = new Date(t + 2 * DAY + HOUR);
    await accountsTick(ctx, cfg, P.f);
    const games = await prisma.evidence.findMany({ where: { challengeId: c.id }, orderBy: { activityDate: "asc" } });
    expect(games.map((e) => Number(e.progressValue))).toEqual([2, 2]); // g1+g3 on day 1, g4+g5 on day 2
    expect(iso(games[0]!.activityDate!)).toBe(iso(new Date(t + 12 * HOUR))); // labelled with the local date
    expect(await prisma.evidence.count({ where: { challengeId: p.id } })).toBe(1); // day 2 had 1 solved puzzle
    advance(2 * HOUR);
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect(await outcome(c.id)).toBe("NO"); // 4 of 5
    expect(await outcome(p.id)).toBe("NO");
  });

  it("community size: GoalFi members and Telegram group members, recorded as one live value", async () => {
    const comm = await prisma.community.create({ data: { slug: `crew-${Date.now()}`, name: "Crew", creatorId: admin.id, telegramChatId: -1001234n } });
    await prisma.communityMember.createMany({ data: [admin, p1].map((u, i) => ({ communityId: comm.id, userId: u.id, role: i === 0 ? "OWNER" : "MEMBER" })) });
    const start = new Date(clock.now.getTime() - MIN);
    const end = new Date(start.getTime() + 2 * DAY);
    const members = await launch({
      title: "Crew reaches 4", marketQuestion: "Crew hits 4 members?", categorySlug: "community", communityId: comm.id, visibility: "COMMUNITY", startDate: start, endDate: end,
      successRule: { type: "individual_threshold", unit: "members", threshold: 4, minParticipants: 1 }, app: { metric: "community_members" },
    });
    const tg = await launch({
      title: "Telegram reaches 100", marketQuestion: "100 in the group?", categorySlug: "community", communityId: comm.id, visibility: "COMMUNITY", startDate: start, endDate: end,
      successRule: { type: "individual_threshold", unit: "Telegram members", threshold: 100, minParticipants: 1 }, app: { metric: "telegram_members" },
    });
    P.data.telegramMembers = 80;
    await accountsTick(ctx, cfg, P.f);
    await prisma.communityMember.createMany({ data: [p2, p3].map((u) => ({ communityId: comm.id, userId: u.id, role: "MEMBER" as const })) });
    P.data.telegramMembers = 104;
    advance(HOUR);
    await accountsTick(ctx, cfg, P.f);
    const live = await prisma.evidence.findMany({ where: { challengeId: members.id, supersededBy: null } });
    expect(live.map((e) => Number(e.progressValue))).toEqual([4]); // superseded 2 → 4, never summed
    expect(await prisma.evidence.count({ where: { challengeId: members.id } })).toBe(2);
    advance(2 * DAY + 3 * HOUR); // past the end, the 2h grace period and the 1h dispute window
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect(await outcome(members.id)).toBe("YES");
    expect(await outcome(tg.id)).toBe("YES");
  });

  it("a lost connection asks to reconnect; disconnecting removes raw data but keeps evidence", async () => {
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const c = await launch({ title: "Steps again", marketQuestion: "Steps again?", startDate: start, endDate: new Date(start.getTime() + DAY), successRule: { type: "individual_threshold", unit: "steps", threshold: 1000, minParticipants: 1 } });
    await joinChallenge(ctx, p1, c.id);
    P.fail(401);
    advance(11 * MIN);
    await accountsTick(ctx, cfg, P.f);
    expect((await prisma.connectedAccount.findFirstOrThrow({ where: { userId: p1.id, provider: "GOOGLE_HEALTH" } })).status).toBe("ERROR");
    expect(await prisma.notification.count({ where: { userId: p1.id, dedupKey: { startsWith: "ACCOUNT_RECONNECT:GOOGLE_HEALTH" } } })).toBe(1);
    P.fail(null);

    const evidence = await prisma.evidence.count({ where: { userId: p1.id } });
    const revokes = P.calls.revoke;
    await disconnectAccount(ctx, p1, cfg, "GOOGLE_HEALTH", P.f);
    expect(P.calls.revoke).toBe(revokes + 1);
    expect(await prisma.connectedAccount.count({ where: { userId: p1.id } })).toBe(0);
    expect(await prisma.activityDaily.count({ where: { userId: p1.id } })).toBe(0);
    expect(await prisma.evidence.count({ where: { userId: p1.id } })).toBe(evidence);
    await disconnectAccount(ctx, p3, cfg, "LICHESS", P.f);
    expect(await prisma.activityEvent.count({ where: { userId: p3.id } })).toBe(0);
  });
});
