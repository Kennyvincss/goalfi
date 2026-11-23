const { chromium } = require("playwright");
const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT_DIR ?? require("node:os").tmpdir();
const ok = (n, c, x) => { console.log(`${c ? "PASS" : "FAIL"} ${n}`, x ?? ""); if (!c) process.exitCode = 1; };
const S = Date.now().toString().slice(-5);
async function session(name) {
  const jar = { cookie: "" };
  const call = async (path, method = "GET", body, raw) => {
    const r = await fetch(B + path, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), cookie: jar.cookie }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get("set-cookie"); if (sc) jar.cookie = sc.split(";")[0];
    let d = null; try { d = await r.clone().json(); } catch {}
    return { status: r.status, data: d, res: r };
  };
  const username = `${name}${S}`;
  await call("/api/auth/signup", "POST", { username, email: `${username}@example.com`, password: "correct horse battery" });
  return { username, call, jar };
}
(async () => {
  const creator = await session("cr"), v1 = await session("va"), v2 = await session("vb"), p1 = await session("pa"), out = await session("ou");

  // ── Builder UI (browser) ──
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "goalfi_session", value: creator.jar.cookie.split("=")[1], url: B }]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(B + "/challenges/new");
  await page.getByRole("button", { name: /Run 50 km in 7 days/ }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // basics → goal
  await page.getByRole("button", { name: "Continue" }).click(); // goal → schedule
  ok("challenges start immediately by default", await page.getByLabel("Start immediately").isChecked());
  await page.getByLabel("Verifiers (GoalFi usernames)").fill(`@${v1.username} @${v2.username}`);
  await page.getByLabel("Approvals required").fill("2");
  await page.getByRole("button", { name: "Continue" }).click(); // → market
  await page.getByRole("button", { name: /No market/ }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // → review
  await page.screenshot({ path: require("node:path").join(OUT, "builder-review.png") });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/challenges\/run-50-km/);
  ok("builder creates a draft and shows the confirm panel", await page.getByText("Review & confirm").isVisible());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm & publish" }).click();
  await page.getByText("live", { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const slug = page.url().split("/challenges/")[1];
  await page.screenshot({ path: require("node:path").join(OUT, "challenge-active.png"), fullPage: true });
  ok("published challenge is live right away (not upcoming)", await page.getByText("active", { exact: true }).first().isVisible());
  ok("no client-side errors", errors.length === 0, errors.join(" | "));

  // ── Participation & verification (API) ──
  const ch = await (await fetch(`${B}/challenges/${slug}`)).text();
  ok("published challenge is public", ch.includes("Run 50 km in 7 days"));
  const challengeId = require("child_process").execSync(`psql -At ${process.env.DATABASE_URL} -c "select id from challenges where slug='${slug}'"`).toString().trim();
  ok("found challenge id", !!challengeId, challengeId);
  let r = await p1.call(`/api/challenges/${challengeId}/join`, "POST");
  ok("participant joins", r.status === 201);
  const fd = new FormData();
  fd.set("description", "Morning 12km run, Strava screenshot attached");
  fd.set("progressValue", "12");
  fd.append("files", new Blob([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake png body " + S)], { type: "image/png" }), "run.png");
  r = await p1.call(`/api/challenges/${challengeId}/evidence`, "POST", null, fd);
  ok("evidence uploaded with content hash", r.status === 201 && /^[0-9a-f]{64}$/.test(r.data.contentHash), r.data);
  const evidenceId = r.data.id;
  r = await out.call(`/api/challenges/${challengeId}/evidence`, "POST", null, (() => { const f = new FormData(); f.set("description", "x x x"); f.set("progressValue", "1"); f.set("links", "https://example.com"); return f; })());
  ok("non-participant cannot submit", r.status === 403);
  r = await out.call(`/api/challenges/${challengeId}/evidence`);
  ok("public sees no unreviewed evidence", r.status === 200 && r.data.evidence.length === 0);
  r = await v1.call(`/api/challenges/${challengeId}/evidence`);
  const fileId = r.data.evidence[0].files[0].id;
  ok("verifier sees pending evidence", r.data.evidence.length === 1);
  ok("outsider cannot fetch pending file", (await out.call(`/api/evidence/files/${fileId}`)).status === 404);
  const f = await v1.call(`/api/evidence/files/${fileId}`);
  ok("verifier can fetch file with hash header", f.status === 200 && f.res.headers.get("content-type") === "image/png" && f.res.headers.get("x-content-sha256")?.length === 64);
  r = await p1.call(`/api/evidence/${evidenceId}/review`, "POST", { decision: "APPROVE" });
  ok("participant cannot self-verify", r.status === 403);
  r = await v1.call(`/api/evidence/${evidenceId}/review`, "POST", { decision: "APPROVE" });
  ok("first approval → under review", r.data?.status === "UNDER_REVIEW", r.data);
  r = await v1.call(`/api/evidence/${evidenceId}/review`, "POST", { decision: "APPROVE" });
  ok("duplicate vote blocked", r.status === 403);
  r = await v2.call(`/api/evidence/${evidenceId}/review`, "POST", { decision: "APPROVE" });
  ok("second approval → approved", r.data?.status === "APPROVED");
  ok("public now sees approved evidence", (await out.call(`/api/challenges/${challengeId}/evidence`)).data.evidence.length === 1);
  r = await creator.call(`/api/challenges/${challengeId}/resolution`);
  ok("resolution blocked before end date", r.data.ok === false && r.data.blockers.some((x) => /not ended/.test(x)), r.data.blockers);
  r = await out.call(`/api/challenges/${challengeId}/resolution`, "POST", { outcome: "YES", confirm: true });
  ok("non-admin cannot resolve", r.status === 403);

  // ── Binary market path: devnet RPC is blocked in this sandbox → must fail cleanly & stay retryable ──
  const start = new Date(Date.now() + 3600e3), end = new Date(Date.now() + 3 * 86400e3);
  r = await creator.call("/api/challenges", "POST", {
    title: "Ship a website in 3 days", description: "Build and launch a website quickly.", categorySlug: "productivity",
    rules: "Must be publicly reachable.", successCriteria: "Live URL approved.", successRule: { type: "milestone", minCompleters: 1 },
    evidenceReq: "URL + screenshot", kind: "PERSONAL", visibility: "PUBLIC", recurrence: "NONE", startDate: start, endDate: end,
    requiredApprovals: 1, disputeWindowHours: 12, verifierUsernames: [v1.username], adminUsernames: [],
    marketQuestion: "Will the website be live in 3 days?", market: { type: "BINARY", initialPriceBps: 3500, initialLiquidityUsdc: 25 },
  });
  ok("binary-market draft created", r.status === 201, r.data);
  const bid = r.data.id, bslug = r.data.slug;
  r = await creator.call(`/api/challenges/${bid}/confirm`, "POST", { acceptRules: false });
  ok("confirm requires explicit rule acceptance", r.status === 422);
  r = await creator.call(`/api/challenges/${bid}/confirm`, "POST", { acceptRules: true });
  ok("on-chain creation failure surfaces as 502 (devnet unreachable here)", r.status === 502, r.data?.error?.slice(0, 120));
  const pg2 = await ctx.newPage();
  await pg2.goto(`${B}/challenges/${bslug}`);
  ok("challenge page offers retry", await pg2.getByRole("button", { name: "Retry market creation" }).isVisible());
  await pg2.screenshot({ path: require("node:path").join(OUT, "market-retry.png"), fullPage: false });
  ok("pending-market challenge is not listed publicly", !(await (await fetch(`${B}/discover?q=Ship`)).text()).includes("Ship a website in 3 days"));
  await b.close();
})();
