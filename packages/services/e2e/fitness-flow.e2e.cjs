// Browser check of the connected-fitness flow. Google itself can't be reached from tests, so the
// connection and synced days are seeded in the database (lastSyncAt = now keeps the page from syncing).
const { chromium } = require("playwright");
const { execSync } = require("node:child_process");
const path = require("node:path");
const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT_DIR ?? require("node:os").tmpdir();
const ok = (n, c, x) => { console.log(`${c ? "PASS" : "FAIL"} ${n}`, x ?? ""); if (!c) process.exitCode = 1; };
const S = Date.now().toString().slice(-5);
const sql = (q) => execSync(`psql -At ${process.env.DATABASE_URL}`, { input: q }).toString().trim();
async function signup(name) {
  const username = `${name}${S}`;
  const r = await fetch(B + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, email: `${username}@example.com`, password: "correct horse battery" }) });
  return { username, cookie: r.headers.get("set-cookie").split(";")[0] };
}
(async () => {
  const walker = await signup("wk"), other = await signup("ot");
  const uid = sql(`select id from users where username='${walker.username}'`);
  sql(`insert into fitness_connections (id,"userId",provider,"accessTokenEnc","refreshTokenEnc","expiresAt",scope,status,"lastSyncAt","updatedAt")
       values ('fc${S}','${uid}','GOOGLE_HEALTH','x','x',now()+interval '1 hour','s','ACTIVE',now(),now())`);
  const steps = [8200, 9100, 7600, 10400, 8800, 9900];
  steps.forEach((v, i) => sql(`insert into fitness_daily (id,"userId",provider,date,metric,value) values ('fd${S}${i}','${uid}','GOOGLE_HEALTH',current_date - ${steps.length - i},'steps',${v})`));

  // OAuth start redirects to Google with read-only scope, offline access and a state cookie.
  const r = await fetch(B + "/api/fitness/google/connect", { headers: { cookie: other.cookie }, redirect: "manual" });
  const loc = new URL(r.headers.get("location"));
  ok("connect redirects to Google sign-in", loc.host === "accounts.google.com" && loc.searchParams.get("scope").includes("googlehealth.activity_and_fitness.readonly") && loc.searchParams.get("access_type") === "offline", loc.toString().slice(0, 120));
  ok("state cookie is httpOnly", /goalfi_fitness_state=.*HttpOnly/i.test(r.headers.get("set-cookie") ?? ""));
  const cb = await fetch(B + "/api/fitness/google/callback?code=abc&state=forged." + uid, { headers: { cookie: other.cookie }, redirect: "manual" });
  ok("callback rejects a forged state", (cb.headers.get("location") ?? "").includes("fitness=expired"));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "goalfi_session", value: walker.cookie.split("=")[1], url: B }]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(B + "/settings");
  ok("settings shows the connected account", await page.getByText("connected", { exact: true }).isVisible());
  await page.goto(B + "/fitness");
  ok("fitness page shows synced days", await page.getByText("10,400").isVisible());
  const avg = Math.round(steps.reduce((a, c) => a + c, 0) / steps.length).toLocaleString("en-US");
  ok("suggestions use the real average", await page.getByText(`average ${avg} steps`).isVisible(), avg);
  await page.screenshot({ path: path.join(OUT, "fitness-page.png"), fullPage: true });

  await page.getByRole("link", { name: "Create this challenge" }).nth(1).click(); // "… every day for a week"
  await page.waitForURL(/suggest=steps-every-day-week/);
  ok("builder opens prefilled", (await page.getByLabel("Title").inputValue()).includes("steps every day for a week"));
  await page.getByRole("button", { name: "Continue" }).click(); // → goal
  ok("verification is Google Health", await page.getByLabel("Steps that make a day count").isVisible());
  await page.getByRole("button", { name: "Continue" }).click(); // → schedule
  ok("schedule uses whole days and no verifiers", (await page.getByLabel("First day").isVisible()) && (await page.getByText("No verifiers needed").isVisible()));
  await page.getByRole("button", { name: "Continue" }).click(); // → market
  await page.getByRole("button", { name: /No market/ }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // → review
  ok("review says automatic", await page.getByText(/Automatic: daily steps from Google Health/).isVisible());
  await page.screenshot({ path: path.join(OUT, "fitness-builder-review.png") });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/challenges\/[a-z0-9-]+-steps-every-day/);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm & publish" }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  ok("challenge says it verifies automatically", await page.getByText(/Verified automatically: each participant’s daily steps sync/).isVisible());
  ok("no evidence upload form", (await page.getByText("Submit evidence").count()) === 0);
  const slug = page.url().split("/challenges/")[1];
  await page.getByRole("button", { name: /Join/ }).click();
  await page.waitForTimeout(1000);
  await page.reload();
  ok("joined participant sees step syncing", await page.getByText(/Syncing automatically from Google Health/).isVisible());
  await page.screenshot({ path: path.join(OUT, "fitness-challenge.png"), fullPage: true });

  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx2.addCookies([{ name: "goalfi_session", value: other.cookie.split("=")[1], url: B }]);
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(`${B}/challenges/${slug}`);
  ok("unconnected visitor is asked to connect instead of join", await p2.getByRole("link", { name: "Connect Google Health" }).isVisible());
  await p2.goto(B + "/fitness");
  await p2.screenshot({ path: path.join(OUT, "fitness-not-connected-mobile.png"), fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok("no horizontal scroll on phone", !overflow);
  ok("no client-side errors", errors.length === 0, errors.join(" | "));
  await b.close();
})();
