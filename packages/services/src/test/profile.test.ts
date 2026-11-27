import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@goalfi/db";
import {
  accountsConfigFromEnv,
  accountsTick,
  activeStreaks,
  completeOnboarding,
  confirmChallenge,
  connectAccount,
  createChallenge,
  joinChallenge,
  onboardingState,
  trackRecord,
  type Actor,
  type Fetch,
} from "../index";
import { makeCtx, makeUser, resetDb } from "./helpers";

const DAY = 86_400_000, HOUR = 3_600_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const cfg = accountsConfigFromEnv("https://goalfi.test", { ACCOUNT_TOKEN_KEY: "test-token-key-0123456789abcdefghijklmnop", WITHINGS_CLIENT_ID: "w", WITHINGS_CLIENT_SECRET: "w" })!;

describe("profiles, streaks and onboarding", () => {
  const t0 = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 6));
  const { ctx, clock } = makeCtx(t0);
  let host: Actor, walker: Actor, verifier: Actor;
  const steps: Record<string, number> = {};
  const f: Fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === "/v2/oauth2") return reply({ status: 0, body: { access_token: "wt", refresh_token: "wr", expires_in: 10800, userid: "w1" } });
    return reply({ status: 0, body: { activities: Object.entries(steps).map(([date, s]) => ({ date, steps: s, is_tracker: true })), more: false, offset: 0 } });
  };

  beforeAll(async () => {
    await resetDb();
    [host, walker, verifier] = (await Promise.all(["phost", "pwalk", "pver"].map((n) => makeUser(n)))) as [Actor, Actor, Actor];
  });
  afterAll(() => prisma.$disconnect());

  it("onboarding reflects what the user actually did, and completes once", async () => {
    await prisma.user.update({ where: { id: walker.id }, data: { onboardedAt: null } });
    expect(await onboardingState(ctx, walker.id)).toEqual({ done: false, hasAccount: false, hasActivity: false, telegram: false, wallet: false });
    await connectAccount(ctx, walker, cfg, "WITHINGS", "code", undefined, f);
    expect((await onboardingState(ctx, walker.id)).hasAccount).toBe(true);
    await completeOnboarding(ctx, walker);
    await completeOnboarding(ctx, walker);
    expect((await onboardingState(ctx, walker.id)).done).toBe(true);
    expect(await prisma.auditLog.count({ where: { actorId: walker.id, action: "user.onboarded" } })).toBe(1);
  });

  it("synced days advance streaks in recurring challenges; the track record counts real outcomes", async () => {
    const start = new Date(`${iso(clock.now)}T00:00:00Z`);
    const c = await createChallenge(ctx, host, {
      title: "Daily 5k steps", description: "Five thousand steps every day.", categorySlug: "fitness", rules: "Synced from a watch.",
      successCriteria: "5,000 steps on 3 days", evidenceReq: "Synced", kind: "GROUP", visibility: "PUBLIC", recurrence: "DAILY",
      startDate: start, endDate: new Date(start.getTime() + 3 * DAY), requiredApprovals: 1, disputeWindowHours: 1,
      verifierUsernames: [verifier.username], adminUsernames: [], verification: "CONNECTED_APP", app: { metric: "steps", dailyTarget: 5000 },
      successRule: { type: "daily_completion", requiredDays: 3, minParticipants: 1 }, autoSettle: true,
      marketQuestion: "3 days of 5k?", market: { type: "NONE" },
    });
    await confirmChallenge(ctx, host, c.id);
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    await joinChallenge(ctx, walker, c.id);
    for (let k = 0; k < 3; k++) {
      steps[iso(new Date(start.getTime() + k * DAY))] = 6000 + k;
      clock.now = new Date(start.getTime() + k * DAY + 20 * HOUR);
      await accountsTick(ctx, cfg, f);
    }
    const streak = await prisma.streak.findFirstOrThrow({ where: { userId: walker.id, challengeId: c.id } });
    expect([streak.current, streak.longest]).toEqual([3, 3]);
    expect(await activeStreaks(ctx, walker.id)).toEqual([expect.objectContaining({ title: "Daily 5k steps", current: 3 })]);

    await prisma.participant.updateMany({ where: { challengeId: c.id, userId: walker.id }, data: { status: "COMPLETED" } });
    await prisma.challenge.update({ where: { id: c.id }, data: { status: "RESOLVED", outcome: "YES" } });
    const walkerRecord = await trackRecord(ctx, walker.id);
    expect(walkerRecord).toMatchObject({ joined: 1, completed: 1, failed: 0, longestStreak: 3, appVerifiedCompleted: 1, selfBetFlags: 0 });
    expect(await trackRecord(ctx, host.id)).toMatchObject({ hosted: 1, hostedSettled: 1, hostedYes: 1 });
  });

  it("a broken streak is no longer active", async () => {
    clock.now = new Date(clock.now.getTime() + 5 * DAY);
    expect(await activeStreaks(ctx, walker.id)).toEqual([]);
  });
});
