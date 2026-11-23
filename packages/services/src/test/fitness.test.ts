import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  autoSettleTick,
  confirmChallenge,
  connectGoogleHealth,
  createChallenge,
  disconnectFitness,
  fitnessTick,
  joinChallenge,
  lifecycleTick,
  parseDailyRollup,
  recentDailySteps,
  submitEvidence,
  systemResolutionReport,
  type Actor,
  type Fetch,
  type GoogleHealthConfig,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const cfg: GoogleHealthConfig = {
  clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://goalfi.test/api/fitness/google/callback",
  tokenKey: "test-token-key-0123456789abcdefghijklmnop",
};

/**
 * Fake Google: OAuth token endpoint + dailyRollUp. `steps[username][date]` is what the "watch" has
 * uploaded so far; tests change it to simulate late syncs.
 */
function fakeGoogle() {
  const steps: Record<string, Record<string, number>> = {};
  const tokens = new Map<string, string>(); // access token → username
  const calls = { token: 0, refresh: 0, rollup: 0, revoke: 0 };
  let failWith: number | null = null;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const f: Fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("client_secret") !== cfg.clientSecret) return reply(401, { error: "invalid_client" });
      if (p.get("grant_type") === "authorization_code") {
        calls.token++;
        const user = p.get("code")!.replace(/^code-/, "");
        tokens.set(`at-${user}`, user);
        return reply(200, { access_token: `at-${user}`, refresh_token: `rt-${user}`, expires_in: 3600, scope: "googlehealth.activity_and_fitness.readonly" });
      }
      calls.refresh++;
      const user = p.get("refresh_token")!.replace(/^rt-/, "");
      const at = `at-${user}-${calls.refresh}`;
      tokens.set(at, user);
      return reply(200, { access_token: at, expires_in: 3600 });
    }
    if (u.startsWith("https://oauth2.googleapis.com/revoke")) {
      calls.revoke++;
      return reply(200, {});
    }
    if (u.endsWith("/steps/dataPoints:dailyRollUp")) {
      calls.rollup++;
      if (failWith) return reply(failWith, { error: { code: failWith, message: "Request had invalid authentication credentials." } });
      const user = tokens.get(String((init?.headers as Record<string, string>).authorization).replace("Bearer ", ""));
      if (!user) return reply(401, { error: { code: 401, message: "Invalid credentials" } });
      const body = JSON.parse(String(init?.body));
      const d = (c: { date: { year: number; month: number; day: number } }) => `${c.date.year}-${String(c.date.month).padStart(2, "0")}-${String(c.date.day).padStart(2, "0")}`;
      const from = d(body.range.start), to = d(body.range.end);
      const points = Object.entries(steps[user] ?? {})
        .filter(([date]) => date >= from && date < to)
        .map(([date, v]) => {
          const [year, month, day] = date.split("-").map(Number);
          return { civilStartTime: { date: { year, month, day } }, civilEndTime: { date: { year, month, day: day! + 1 } }, steps: { countSum: String(v) } };
        });
      return reply(200, { rollupDataPoints: points });
    }
    return reply(404, {});
  };
  return { f, steps, calls, fail: (s: number | null) => (failWith = s) };
}

describe("parseDailyRollup", () => {
  it("reads civil dates and int64-as-string step sums, skipping malformed points", () => {
    const r = parseDailyRollup({
      rollupDataPoints: [
        { civilStartTime: { date: { year: 2026, month: 11, day: 3 } }, steps: { countSum: "12034" } },
        { civilStartTime: { date: { year: 2026, month: 11, day: 4 } }, steps: { countSum: 800 } },
        { civilStartTime: { date: { year: 2026, month: 11, day: 5 } }, steps: {} },
        { civilStartTime: {}, steps: { countSum: "5" } },
      ],
      nextPageToken: "p2",
    });
    expect(r.rows).toEqual([{ date: "2026-11-03", value: 12034 }, { date: "2026-11-04", value: 800 }]);
    expect(r.nextPageToken).toBe("p2");
    expect(parseDailyRollup({})).toEqual({ rows: [], nextPageToken: null });
  });
});

describe("connected fitness (Google Health steps)", () => {
  // 06:00 UTC, so "today" and the challenge's whole UTC days line up.
  const t0 = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 6));
  const { ctx, gateway, clock, advance } = makeCtx(t0);
  const g = fakeGoogle();
  let admin: Actor, p1: Actor, p2: Actor, p3: Actor;
  const today = iso(t0), yesterday = iso(new Date(t0.getTime() - DAY)), tomorrow = iso(new Date(t0.getTime() + DAY));
  const dayStart = new Date(`${today}T00:00:00Z`);

  beforeAll(async () => {
    await resetDb();
    admin = await makeUser("fadm");
    [p1, p2, p3] = (await Promise.all(["fa", "fb", "fc"].map((n) => makeUser(n)))) as [Actor, Actor, Actor];
  });
  afterAll(() => prisma.$disconnect());

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Two of us walk 15k", description: "Two participants each walk 15,000 steps over two days.", categorySlug: "fitness",
    rules: "Steps come from Google Health.", successCriteria: "At least 2 participants record 15,000 steps.",
    successRule: { type: "individual_threshold", unit: "steps", threshold: 15_000, minParticipants: 2 },
    evidenceReq: "Synced automatically", kind: "GROUP", visibility: "PUBLIC", recurrence: "NONE",
    startDate: dayStart, endDate: new Date(dayStart.getTime() + 2 * DAY),
    requiredApprovals: 1, disputeWindowHours: 1, verifierUsernames: [], adminUsernames: [],
    verification: "CONNECTED_APP", fitness: { metric: "steps" }, autoSettle: true,
    marketQuestion: "Will two of us walk 15k steps?", market: { type: "BINARY", initialPriceBps: 5000, initialLiquidityUsdc: 10 },
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

  it("validates app-verified challenges", async () => {
    await expect(createChallenge(ctx, admin, input({ fitness: undefined }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "milestone", minCompleters: 1 } }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "individual_threshold", unit: "km", threshold: 5, minParticipants: 1 } }))).rejects.toMatchObject({ status: 422 });
    await expect(createChallenge(ctx, admin, input({ successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 } }))).rejects.toMatchObject({ status: 422 });
  });

  it("connecting stores encrypted tokens and pulls recent history", async () => {
    g.steps[p1.username] = { [yesterday]: 9000 };
    await connectGoogleHealth(ctx, p1, cfg, `code-${p1.username}`, g.f);
    const conn = await prisma.fitnessConnection.findFirstOrThrow({ where: { userId: p1.id } });
    expect(conn.status).toBe("ACTIVE");
    expect(conn.accessTokenEnc).not.toContain(`at-${p1.username}`);
    expect(conn.refreshTokenEnc).not.toContain(`rt-${p1.username}`);
    expect(await recentDailySteps(ctx, p1.id)).toEqual([{ date: yesterday, value: 9000 }]);
    g.steps[p2.username] = {};
    await connectGoogleHealth(ctx, p2, cfg, `code-${p2.username}`, g.f);
  });

  it("joining needs a connection; manual evidence is refused", async () => {
    const c = await launch();
    await expect(joinChallenge(ctx, p3, c.id)).rejects.toMatchObject({ status: 409 });
    await joinChallenge(ctx, p1, c.id);
    await joinChallenge(ctx, p2, c.id);
    await expect(submitEvidence(ctx, p1, c.id, { description: "20000 steps", progressValue: 20000 }, [])).rejects.toMatchObject({ status: 409 });
  });

  it("syncs steps into approved evidence, supersedes changed totals, and settles itself after the grace period", async () => {
    const c = await prisma.challenge.findFirstOrThrow({ where: { title: "Two of us walk 15k" } });
    g.steps[p1.username] = { [yesterday]: 9000, [today]: 7000 }; // yesterday is outside the challenge
    g.steps[p2.username] = { [today]: 4000 };
    advance(10 * MIN + 1);
    expect(await fitnessTick(ctx, cfg, g.f)).toMatchObject({ challenges: 1, evidence: 2 });
    const ev1 = await prisma.evidence.findMany({ where: { challengeId: c.id, userId: p1.id } });
    expect(ev1).toHaveLength(1);
    expect(ev1[0]).toMatchObject({ status: "APPROVED", autoDecision: "CONNECTED_APP" });
    expect(Number(ev1[0]!.progressValue)).toBe(7000);

    // Nothing changed → no new rows, and the 10-minute throttle avoids calling Google again.
    const before = g.calls.rollup;
    expect((await fitnessTick(ctx, cfg, g.f)).evidence).toBe(0);
    expect(g.calls.rollup).toBe(before);

    // The watch syncs more steps: the old row is superseded, never edited.
    g.steps[p1.username]![today] = 8200;
    g.steps[p1.username]![tomorrow] = 8000;
    g.steps[p2.username] = { [today]: 4000, [tomorrow]: 6000 };
    advance(DAY); // day 2, 06:00 (the access tokens expired → refreshed)
    expect(await fitnessTick(ctx, cfg, g.f)).toMatchObject({ evidence: 3 });
    expect(g.calls.refresh).toBeGreaterThanOrEqual(2);
    const live = await prisma.evidence.findMany({ where: { challengeId: c.id, userId: p1.id, supersededBy: null } });
    expect(live.map((e) => Number(e.progressValue)).sort()).toEqual([8000, 8200]);
    const old = await prisma.evidence.findFirstOrThrow({ where: { challengeId: c.id, userId: p1.id, progressValue: 7000 } });
    expect(old.status).toBe("APPROVED"); // immutable, but superseded
    expect(await prisma.evidence.count({ where: { supersedesId: old.id } })).toBe(1);

    // Ended: settlement waits for late uploads (2h), then the dispute window (1h).
    advance(DAY - 6 * HOUR + MIN); // 00:01 after the last day
    await lifecycleTick(ctx);
    let report = await systemResolutionReport(ctx, c.id);
    expect(report.blockers.join(" ")).toMatch(/late fitness data/);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 0, waiting: 1 });

    // A late upload for the last day still counts.
    g.steps[p2.username]![tomorrow] = 11_500;
    advance(90 * MIN); // 01:31
    await fitnessTick(ctx, cfg, g.f);
    advance(31 * MIN); // 02:02, past the 2h grace period
    expect((await fitnessTick(ctx, cfg, g.f)).challenges).toBe(0); // no longer synced
    report = await systemResolutionReport(ctx, c.id);
    expect(report.blockers.join(" ")).toMatch(/Dispute window/);
    advance(HOUR);
    expect(await autoSettleTick(ctx)).toMatchObject({ settled: 1 });

    const done = await prisma.challenge.findUniqueOrThrow({ where: { id: c.id }, include: { market: true } });
    // p1: 8,200 + 8,000 = 16,200 ✓   p2: 4,000 + 11,500 = 15,500 ✓  → YES
    expect(done).toMatchObject({ status: "RESOLVED", outcome: "YES", resolvedById: null });
    expect(gateway.markets.get(done.market!.marketAddress!)?.winningSide).toBe("YES");
  });

  it("daily-completion days only count at the daily target; a lost connection asks to reconnect", async () => {
    advance(2 * DAY); // a fresh window
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const [d1, d2] = [iso(start), iso(new Date(start.getTime() + DAY))];
    const c = await launch({
      title: "8k steps on 2 days", marketQuestion: "Will I hit 8k twice?", startDate: start, endDate: new Date(start.getTime() + 2 * DAY),
      successRule: { type: "daily_completion", requiredDays: 2, minParticipants: 1 }, fitness: { metric: "steps", dailyTarget: 8000 },
    });
    await joinChallenge(ctx, p1, c.id);
    g.steps[p1.username] = { [d1]: 7999, [d2]: 12_000 };
    advance(DAY);
    await fitnessTick(ctx, cfg, g.f);
    const ev = await prisma.evidence.findMany({ where: { challengeId: c.id } });
    expect(ev.map((e) => e.activityDate!.toISOString().slice(0, 10))).toEqual([d2]); // 7,999 < 8,000

    g.fail(401);
    advance(11 * MIN);
    await fitnessTick(ctx, cfg, g.f);
    const conn = await prisma.fitnessConnection.findFirstOrThrow({ where: { userId: p1.id } });
    expect(conn.status).toBe("ERROR");
    expect(await prisma.notification.count({ where: { userId: p1.id, dedupKey: { startsWith: "FITNESS_RECONNECT:" } } })).toBe(1);
    g.fail(null);
    advance(2 * DAY);
    await lifecycleTick(ctx);
    await autoSettleTick(ctx);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: c.id } })).outcome).toBe("NO"); // only 1 of 2 days counted
  });

  it("disconnecting revokes access and deletes raw step data but keeps evidence", async () => {
    const evidence = await prisma.evidence.count({ where: { userId: p2.id } });
    await disconnectFitness(ctx, p2, cfg, g.f);
    expect(g.calls.revoke).toBe(1);
    expect(await prisma.fitnessConnection.count({ where: { userId: p2.id } })).toBe(0);
    expect(await prisma.fitnessDaily.count({ where: { userId: p2.id } })).toBe(0);
    expect(await prisma.evidence.count({ where: { userId: p2.id } })).toBe(evidence);
  });
});
