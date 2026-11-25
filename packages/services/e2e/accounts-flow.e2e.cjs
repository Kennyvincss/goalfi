// Browser check of the connected-accounts flow. Google itself can't be reached from tests, so the
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
  sql(`insert into connected_accounts (id,"userId",provider,"accessTokenEnc","refreshTokenEnc","expiresAt",scope,status,"lastSyncAt","updatedAt")
       values ('fc${S}','${uid}','GOOGLE_HEALTH','x','x',now()+interval '1 hour','activity https://www.googleapis.com/auth/googlehealth.sleep.readonly','ACTIVE',now(),now())`);
  const cid = sql(`insert into communities (id,slug,name,creator_id,"updatedAt") values ('cm${S}','crew-${S}','Crew ${S}','${uid}',now()) returning id`).split("\n")[0];
  sql(`insert into community_members (id,community_id,user_id,role) values ('mm${S}','${cid}','${uid}','OWNER')`);
  const steps = [8200, 9100, 7600, 10400, 8800, 9900];
  steps.forEach((v, i) => sql(`insert into activity_daily (id,"userId",provider,date,metric,value) values ('fd${S}${i}','${uid}','GOOGLE_HEALTH',current_date - ${steps.length - i},'steps',${v})`));
  [400, 380, 410].forEach((v, i) => sql(`insert into activity_daily (id,"userId",provider,date,metric,value) values ('fw${S}${i}','${uid}','GOOGLE_HEALTH',current_date - ${3 - i},'wake_time',${v})`));

  // OAuth start redirects to Google with read-only scope, offline access and a state cookie.
  const r = await fetch(B + "/api/accounts/google/connect", { headers: { cookie: other.cookie }, redirect: "manual" });
  const loc = new URL(r.headers.get("location"));
  ok("Google connect asks for activity + sleep, offline", loc.host === "accounts.google.com" && loc.searchParams.get("scope").includes("activity_and_fitness.readonly") && loc.searchParams.get("scope").includes("sleep.readonly") && loc.searchParams.get("access_type") === "offline", loc.toString().slice(0, 120));
  ok("state cookie is httpOnly", /goalfi_account_state=.*HttpOnly/i.test(r.headers.get("set-cookie") ?? ""));
  const li = await fetch(B + "/api/accounts/lichess/connect", { headers: { cookie: other.cookie }, redirect: "manual" });
  const lloc = new URL(li.headers.get("location"));
  ok("Lichess connect uses PKCE with no registration", lloc.host === "lichess.org" && lloc.pathname === "/oauth" && lloc.searchParams.get("code_challenge_method") === "S256" && lloc.searchParams.get("scope") === "puzzle:read", lloc.toString().slice(0, 120));
  const gh = await fetch(B + "/api/accounts/github/connect", { headers: { cookie: other.cookie }, redirect: "manual" });
  ok("unconfigured GitHub explains instead of failing", (gh.headers.get("location") ?? "").includes("account=not_configured"));
  const cb = await fetch(B + "/api/accounts/google/callback?code=abc&state=forged." + uid, { headers: { cookie: other.cookie }, redirect: "manual" });
  ok("callback rejects a forged state", (cb.headers.get("location") ?? "").includes("account=expired"));

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "goalfi_session", value: walker.cookie.split("=")[1], url: B }]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(B + "/settings");
  ok("settings shows the connected account", await page.locator("#accounts").getByText("Connected", { exact: true }).isVisible());
  await page.screenshot({ path: path.join(OUT, "settings-accounts.png"), fullPage: true });
  await page.goto(B + "/connected");
  ok("connected page shows synced days", await page.getByText("10,400").isVisible());
  ok("suggestions use the real history", await page.getByText("based on your last 6 complete days").isVisible());
  await page.screenshot({ path: path.join(OUT, "connected-page.png"), fullPage: true });
  await page.getByRole("tab", { name: "Wake-up time" }).click();
  await page.waitForURL(/metric=wake_time/);
  ok("wake-up suggestions from sleep data", await page.getByText(/Wake up by 06:45 every day for a week/).isVisible());
  ok("community growth suggestion", await page.getByText(new RegExp(`Crew ${S} reaches`)).first().isVisible());
  await page.goto(B + "/connected?metric=steps");

  ok("many step ideas (easy to hard, today to a month)", (await page.getByRole("link", { name: "Create this challenge" }).count()) >= 12);
  await page.locator("div.flex.flex-col", { hasText: /steps every day for a week/ }).first().getByRole("link", { name: "Create this challenge" }).click();
  await page.waitForURL(/suggest=steps%3Aevery-day-week/);
  ok("builder opens prefilled", (await page.getByLabel("Title").inputValue()).includes("steps every day for a week"));
  await page.getByRole("button", { name: "Continue" }).click(); // → goal
  ok("verification is the connected app, steps", (await page.getByLabel("What is measured").inputValue()) === "steps" && (await page.getByLabel("Steps that make a day count").isVisible()));
  await page.getByRole("button", { name: "Continue" }).click(); // → schedule
  ok("schedule uses whole days and no verifiers", (await page.getByLabel("First day").isVisible()) && (await page.getByText("No verifiers needed").isVisible()));
  await page.getByRole("button", { name: "Continue" }).click(); // → market
  await page.getByRole("button", { name: /No market/ }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // → review
  ok("review says automatic", await page.getByText(/Automatic: steps from Google Health/).isVisible());
  await page.screenshot({ path: path.join(OUT, "builder-review.png") });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/challenges\/[a-z0-9-]+-steps-every-day/);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm & publish" }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  ok("challenge says it verifies automatically", await page.getByText(/Verified automatically: Steps, synced from each participant’s Google Health account/).isVisible());
  ok("no evidence upload form", (await page.getByText("Submit evidence").count()) === 0);
  const slug = page.url().split("/challenges/")[1];

  // Ideas page: ideas from your data, for your communities, and ones anyone can do.
  await page.goto(B + "/ideas");
  ok("ideas default to your data", await page.getByRole("link", { name: /From your data \(\d+\)/ }).isVisible());
  ok("ideas cover several metrics", (await page.getByRole("heading", { name: /^Steps/ }).count()) === 1 && (await page.getByRole("heading", { name: /^Wake-up time/ }).count()) === 1);
  await page.getByRole("link", { name: "Hard", exact: true }).click();
  await page.waitForURL(/difficulty=hard/);
  ok("difficulty filter", (await page.locator("span", { hasText: /^Easy$/ }).count()) === 0 && (await page.locator("span", { hasText: /^Hard$/ }).count()) > 1);
  await page.goto(B + "/ideas?tab=groups");
  ok("community ideas include growth goals", await page.getByText(new RegExp(`Crew ${S} (reaches|doubles)`)).first().isVisible());
  await page.goto(B + "/ideas?tab=anyone&category=lifestyle");
  ok("task ideas anyone can do, by category", await page.getByText("No added sugar for 14 days").isVisible() && !(await page.getByText("Read three books in 30 days").isVisible()));
  await page.screenshot({ path: path.join(OUT, "ideas-anyone.png"), fullPage: true });
  await page.locator("div.flex.flex-col", { hasText: "No added sugar for 14 days" }).first().getByRole("link", { name: "Create this challenge" }).click();
  await page.waitForURL(/template=no-sugar-14/);
  ok("idea opens the builder prefilled", (await page.getByLabel("Title").inputValue()) === "No added sugar for 14 days");
  await page.goto(B + "/challenges/new");
  ok("builder shows picks from your data", await page.getByText("Suggested from your data").isVisible());
  await page.goto(B + `/challenges/${slug}`);
  await page.getByRole("button", { name: /Join/ }).click();
  await page.waitForTimeout(1000);
  await page.reload();
  ok("joined participant sees step syncing", await page.getByText(/Syncing automatically from Google Health/).isVisible());
  await page.screenshot({ path: path.join(OUT, "connected-challenge.png"), fullPage: true });

  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx2.addCookies([{ name: "goalfi_session", value: other.cookie.split("=")[1], url: B }]);
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(`${B}/challenges/${slug}`);
  ok("unconnected visitor is asked to connect instead of join", await p2.getByRole("link", { name: "Connect Google Health" }).isVisible());
  await p2.goto(B + "/connected");
  await p2.screenshot({ path: path.join(OUT, "connected-mobile.png"), fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok("no horizontal scroll on phone", !overflow);
  ok("no client-side errors", errors.length === 0, errors.join(" | "));
  await b.close();
})();
