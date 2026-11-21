# Deploying GoalFi (devnet)

GoalFi has three runtime pieces plus the services they talk to:

```
            ┌──────────────── Vercel ────────────────┐
 browser ──▶│ apps/web  (website + REST API /api/*)  │──┐
            └────────────────────────────────────────┘  │
                                                        ├──▶ Postgres (Neon or Supabase)
            ┌──── Railway / Render / Fly (Docker) ───┐  │
Telegram ◀─▶│ apps/bot  (bot + background workers)   │──┘
            └────────────────────────────────────────┘
 both ──▶ Solana devnet RPC (pm-AMM program)      web ──▶ Supabase Storage (evidence files)
```

- **The website** runs on Vercel (serverless).
- **The bot** must run on a host that keeps a process alive. It also runs the scheduler, the
  transaction reconciler and the price indexer, so the bot is how challenges move from active to
  in-review on time and how prices get recorded.
- **Vercel's filesystem is not persistent**, so evidence uploads must go to Supabase Storage.

Do the steps in order. Budget about an hour.

---

## 0. Accounts you need

| Service | Used for | Free tier OK? |
|---|---|---|
| GitHub | the repo (already there) | yes |
| [Vercel](https://vercel.com) | website | yes (Hobby) |
| [Neon](https://neon.tech) **or** [Supabase](https://supabase.com) | Postgres | yes |
| [Supabase](https://supabase.com) | evidence file storage | yes |
| [Railway](https://railway.app) (or Render / Fly.io) | Telegram bot + workers | Railway has a trial; Render workers are paid |
| Telegram | the bot (via @BotFather) | yes |
| Optional: [Helius](https://helius.dev) / QuickNode | reliable devnet RPC | yes |

You also need Node 22 and pnpm 10 on your computer, for one-time setup commands:

```bash
corepack enable
```

```bash
git clone https://github.com/Kennyvincss/goalfi.git && cd goalfi && git checkout claude/kind-fermat-utm571 && pnpm install
```

> **Branch:** everything so far is on `claude/kind-fermat-utm571`. Merge it into `main` (open a pull
> request on GitHub and merge it) before step 5, because Vercel deploys `main` to production by default.

---

## 1. Database (Postgres)

**Option A, Neon via Vercel (simplest):** after creating the Vercel project in step 5, open
*Storage → Create → Neon*. Vercel then sets `DATABASE_URL` for you. You still run the migrations below.

**Option B, Supabase or Neon directly:** create a project and copy its connection string.

- For **migrations**, use the *direct* connection (Supabase: "Session" / port 5432; Neon: the
  non-`-pooler` host).
- For the **website and bot** at runtime, use the *pooled* connection (Supabase: "Transaction" / port 6543;
  Neon: the `-pooler` host). If you ever see `prepared statement ... already exists` errors, switch
  runtime to the direct URL.

Create the tables and the categories. This is one time, from your computer:

```bash
DATABASE_URL="postgresql://…direct-connection…" pnpm --filter @goalfi/db migrate:deploy
```

```bash
DATABASE_URL="postgresql://…direct-connection…" pnpm --filter @goalfi/db seed
```

Run `migrate:deploy` again whenever a new migration is added to `packages/db/prisma/migrations`.
The seed only inserts the 7 categories; it never creates users or fake activity.

---

## 2. Evidence storage (Supabase Storage)

1. In Supabase: **Storage → New bucket**, name it `evidence`, and keep it **private** (do not tick "Public").
   GoalFi serves files only through its own authorized `/api/evidence/files/:id` route.
2. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and the **service_role** key
   (`SUPABASE_SERVICE_ROLE_KEY`). The service_role key is a full-access secret: put it only in
   server env vars, never in a `NEXT_PUBLIC_` variable.

---

## 3. Platform market-authority key (devnet)

This key creates and resolves the pm-AMM markets. It never touches user funds.

```bash
pnpm --filter @goalfi/chain keygen
```

This writes `.devnet-keys/authority.json` (git-ignored). Its `secret` field is the value for
`GOALFI_MARKET_AUTHORITY_SECRET`, and `publicKey` is the address.

- **Fund it with devnet SOL** (it pays rent for each new market's accounts): go to
  <https://faucet.solana.com>, paste the `publicKey`, and request 2–5 SOL. Top it up when market creation
  starts failing with "insufficient lamports".
- Treat the secret like a password: store it only in Vercel and bot-host env vars.
- **Never** reuse a devnet key on mainnet.

Test USDC (mUSDC) is needed by **users** who fund markets or trade, not by this key. How testers get
mUSDC is documented on <https://predict-pm-amm.dev> (its faucet couldn't be checked during development).

---

## 4. Telegram bot (BotFather)

In Telegram, open **@BotFather**:

1. `/newbot` → name `GoalFi` → pick a username, e.g. `GoalFiBot`. Copy the **token**: this is `TELEGRAM_BOT_TOKEN`.
2. `/setjoingroups` → choose your bot → **Enable** (required for “Add GoalFi to a group”).
3. Privacy mode can stay **enabled**; commands still work.
4. `/setdomain` → do this **after step 5**, with your Vercel domain (e.g. `goalfi.vercel.app`).
   The Telegram Login button on the website only works on this domain.

---

## 5. Website on Vercel

1. **Vercel → Add New → Project → Import** `Kennyvincss/goalfi`.
2. **Root Directory:** `apps/web`. Vercel detects Next.js and the pnpm workspace and installs
   from the repo root automatically. Leave Build/Install commands at their defaults.
   Under *Settings → General*, keep **“Include files outside the root directory in the Build Step”** enabled
   (it is by default). The website imports `packages/*`.
3. **Environment Variables:** add the ones marked “web” in the [reference table](#environment-variable-reference).
   Set `GOALFI_APP_URL` to the URL you'll use (e.g. `https://goalfi.vercel.app`; change it later if needed).
   Optional: add `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses exactly pnpm 10.28.0 from `package.json`.
4. **Deploy.**
5. If your final domain differs from what you entered, update `GOALFI_APP_URL`, then
   **Deployments → … → Redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so
   *any* change to them needs a redeploy.
6. Go back to BotFather and run `/setdomain` (step 4.4).

The build doesn't need database access. Pages connect to the database only when requested.

---

## 6. Bot + workers on Railway (Docker)

The repo ships `apps/bot/Dockerfile`. It builds from the **repo root** and runs
`pnpm --filter @goalfi/bot start`. It needs no inbound port in the default long-polling mode.

**Railway**
1. **New Project → Deploy from GitHub repo →** `Kennyvincss/goalfi`.
2. In the service's **Variables**, add `RAILWAY_DOCKERFILE_PATH=apps/bot/Dockerfile` plus every variable
   marked “bot” in the [reference table](#environment-variable-reference). Use the same `DATABASE_URL`,
   authority secret and cluster settings as Vercel.
3. Keep the root directory `/` (the Dockerfile needs the whole workspace). Deploy.
4. Logs should show `[bot] @YourBot polling`. Send the bot `/start` in Telegram to check it.

**Render:** create a **Background Worker**, choose Runtime *Docker*, set Dockerfile Path `apps/bot/Dockerfile`
and Docker Build Context `.`, then add the same env vars.

**Fly.io:** run `fly launch --dockerfile apps/bot/Dockerfile --no-deploy` from the repo root, then
`fly secrets set KEY=value …` for each variable, then `fly deploy`.

**Run exactly one bot instance.** Telegram long polling allows only one consumer per token. (The
workers are idempotent, so a brief overlap during a redeploy is harmless.)

**Optional webhook mode** (instead of polling): set `TELEGRAM_WEBHOOK_URL=https://<bot-host>/telegram`,
`TELEGRAM_WEBHOOK_SECRET=<random string>` and `PORT=8080`, and expose that port publicly. Health check: `GET /healthz`.

---

## 7. Scheduler

The bot process already runs the scheduler every minute, so nothing else is required.

If you can't run the bot yet, Vercel Cron can call the same tick (`GET /api/cron/tick`). Set `CRON_SECRET`
in Vercel (Vercel sends it as `Authorization: Bearer …` automatically), then add `apps/web/vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "*/5 * * * *" }] }
```

Sub-daily schedules need a **Vercel Pro** plan; Hobby allows only one run per day, which is too slow for
challenge deadlines. Running both the bot and the cron at once is safe.

---

## 8. Make yourself a platform admin

Sign up on the website first, then run this once against the database (Neon/Supabase SQL editor):

```sql
UPDATE users SET role = 'PLATFORM_ADMIN' WHERE username = 'your_username';
```

`/admin` then shows platform stats and the audit log. It returns 404 for everyone else.

---

## 9. Smoke test (about 10 minutes)

1. Open the site → **Sign up**. Then **Settings → Telegram**: the login widget appears (this confirms `/setdomain` worked).
2. **Settings → Solana wallet** → connect Phantom (switched to *Devnet*) → **Link this wallet** → sign.
3. **Telegram page → Start the bot**, then **Add GoalFi to a group**. The bot replies “now connected” in the group.
4. **Create challenge** → pick a template → *No market* → confirm. It appears on **Discover**, and the
   group gets an announcement within ~10 s.
5. With a second account: join, upload evidence. Verifiers get a Telegram message with **✅ Approve**.
6. Create a challenge with a **YES/NO market** → confirm. The market is created on-chain (watch for the
   “Fund the market” panel) → deposit mUSDC from the linked wallet → the challenge goes live.
7. Open the market → buy YES with a small amount → it appears in **Portfolio**.
8. After the end date, the dispute window and all reviews: the admin resolves, then the winner claims in Portfolio.

---

## Environment variable reference

| Variable | Web | Bot | Example / notes |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✓ | ✓ | pooled Postgres URL (see step 1) |
| `GOALFI_APP_URL` | ✓ | ✓ | `https://goalfi.vercel.app`, used in links and in the wallet-link message domain |
| `GOALFI_CLUSTER` | ✓ | ✓ | `devnet` |
| `GOALFI_RPC_URL` | ✓ | ✓ | `https://api.devnet.solana.com` or a private devnet RPC URL |
| `GOALFI_MARKET_AUTHORITY_SECRET` | ✓ | ✓ | secret from step 3 (**secret**) |
| `NEXT_PUBLIC_GOALFI_CLUSTER` | ✓ | | `devnet` (must match `GOALFI_CLUSTER`) |
| `NEXT_PUBLIC_GOALFI_RPC_URL` | ✓ | | RPC used by browsers. It's public, so use a key restricted to your domain, or the public endpoint |
| `TELEGRAM_BOT_TOKEN` | ✓ | ✓ | from BotFather (**secret**). The web app uses it to verify Telegram logins |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | ✓ | | `GoalFiBot` (no @) |
| `STORAGE_DRIVER` | ✓ | ✓ | `supabase` |
| `SUPABASE_URL` | ✓ | ✓ | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | **secret** |
| `SUPABASE_BUCKET` | ✓ | ✓ | `evidence` |
| `CRON_SECRET` | optional | | only with Vercel Cron (step 7) |
| `TELEGRAM_WEBHOOK_URL` / `TELEGRAM_WEBHOOK_SECRET` / `PORT` | | optional | webhook mode only |
| `GOALFI_ENABLE_MAINNET` | | | **leave unset**. See below |

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Telegram login button missing or “Bot domain invalid” | Run BotFather `/setdomain` with the exact site domain, and set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, then redeploy |
| “Market creation is not configured on this server” | `GOALFI_MARKET_AUTHORITY_SECRET` is missing on Vercel |
| “On-chain market creation failed … insufficient lamports” | Fund the authority address with devnet SOL (step 3), then press **Retry** on the challenge |
| Wallet linking fails with a signature error | `GOALFI_APP_URL` doesn't match the domain you're on |
| Prices never update / challenges stay “active” after the end date | The bot isn't running (or no Vercel Cron); check the bot logs |
| Trades stuck as “pending” in Portfolio | Normal for a few seconds; the bot's reconciler confirms them. If they persist, check the bot logs and `GOALFI_RPC_URL` |
| Evidence uploads fail on Vercel | `STORAGE_DRIVER=supabase` and its keys aren't set (local storage doesn't work on Vercel) |
| Public RPC errors / 429 rate limits | Use a dedicated devnet RPC (Helius/QuickNode) for both RPC variables |
| `DATABASE_URL is not set` at runtime | Add it in Vercel for the Production (and Preview) environment, then redeploy |

---

## Mainnet

Leave it off. GoalFi refuses to start on mainnet unless `GOALFI_ENABLE_MAINNET=I_UNDERSTAND_THE_RISKS`,
and real-money trading must wait for:
- a security audit;
- legal and regulatory review for prediction markets in your jurisdictions;
- KMS/HSM custody for the authority key;
- a successful run of the devnet end-to-end loop (`pnpm --filter @goalfi/chain devnet:e2e`).
