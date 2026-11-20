# GoalFi Roadmap

Status legend: ✅ done · 🟡 in progress · ⬜ not started

## Phase 0 — Research & architecture ✅
- pm-AMM SDK/IDL research → `docs/PM_AMM_INTEGRATION.md`
- Architecture → `docs/ARCHITECTURE.md`
- Database schema → `packages/db/prisma/schema.prisma`

## Phase 1 — Website foundation ✅
- Monorepo, Next.js 16 app, design system, responsive navigation
- Landing page (real stats only, interactive flow, FAQ)
- Auth: email/password (scrypt), Telegram Login (HMAC-verified), wallet linking (signed nonce, replay-safe)
- Dashboard, discover/markets/challenges listings, challenge & community detail, profile, leaderboard,
  settings, portfolio (on-chain balance + tx history), Telegram page with one-time deep links, admin overview
- Postgres-backed rate limiting, audit logs
- Verified: production build, 19 HTTP API checks, DB trigger checks, desktop/mobile screenshots

## Phase 2 — Telegram integration ✅ (offline-tested; live Telegram API blocked in dev sandbox)
- grammY bot: /start /help /dashboard /challenges /markets /leaderboard /submit /join
- `startgroup` deep link → `/start <code>` → bot membership + sender admin check (`getChatMember`) → community
- Account linking via `/start <code>` in private chat; removal/migration handling
- Notification mirroring with quick-approve actions; deduplicated group announcement outbox
- Workers: lifecycle scheduler, tx reconciler, stuck-resolution reconciler, market snapshot indexer
- Polling or webhook mode. See `docs/TELEGRAM.md`. 6 bot tests (real updates, captured Bot API calls)

## Phase 3 — Challenge system ✅
- `@goalfi/services` shared by web + bot; 17 integration tests on Postgres
- Builder with templates and structured success rules → draft → summary + explicit rule confirmation
- YES/NO market created on-chain at confirm (intent row, retry); goes live after verified creator funding
- Join/leave, evidence upload (content-hash manifest, immutable, supersede), authorized file serving
- N-of-M verification, review queue, disputes with final admin rulings, reputation + streaks
- Resolution gate + admin confirmation → on-chain resolve → participants/reputation/winners
- Browser e2e: 23 checks (builder UI → publish → join → upload → 2-of-2 approval → gated resolution;
  on-chain create failure is surfaced and retryable)

## Phase 4 — pm-AMM integration 🟡 (create/fund/resolve wired end-to-end; trading UI next; live devnet run pending network access)
- Market creation with platform authority, liquidity seeding from creator wallet
- Swaps (buy/sell) with simulated quotes, resolution, claims
- Devnet e2e script: create → deposit → swap → (expire) → resolve → claim

## Phase 5 — Marketplace & portfolio ⬜
## Phase 6 — Community features (leaderboards, reputation, streaks, recurring) ⬜
## Phase 7 — Testing & devnet deployment ⬜

## Blockers
- Container network policy blocks `predict-pm-amm.dev` and `api.devnet.solana.com`.
  Add both to the environment's allowed hosts to run live devnet tests.
