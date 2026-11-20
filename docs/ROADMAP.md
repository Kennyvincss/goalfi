# GoalFi Roadmap

Status legend: ✅ done · 🟡 in progress · ⬜ not started

## Phase 0 — Research & architecture ✅
- pm-AMM SDK/IDL research → `docs/PM_AMM_INTEGRATION.md`
- Architecture → `docs/ARCHITECTURE.md`
- Database schema → `packages/db/prisma/schema.prisma`

## Phase 1 — Website foundation 🟡
- Monorepo, Next.js app, design system, navigation
- Landing page (real stats only)
- Auth: email/password, Telegram Login, wallet linking (SIWS)
- Profile, dashboard, discover

## Phase 2 — Telegram integration ⬜
- grammY bot, /start /help /dashboard /challenges /markets /leaderboard /submit
- `startgroup` deep link → `my_chat_member` → admin check (`getChatMember`) → one-time link code → community
- Announcements & notification dispatcher

## Phase 3 — Challenge system ⬜
- Create flow with templates + summary/confirm, categories, participants
- Evidence upload (hash + immutable), verification thresholds, disputes

## Phase 4 — pm-AMM integration ⬜ (code written in `@goalfi/chain`; live devnet run pending network access)
- Market creation with platform authority, liquidity seeding from creator wallet
- Swaps (buy/sell) with simulated quotes, resolution, claims
- Devnet e2e script: create → deposit → swap → (expire) → resolve → claim

## Phase 5 — Marketplace & portfolio ⬜
## Phase 6 — Community features (leaderboards, reputation, streaks, recurring) ⬜
## Phase 7 — Testing & devnet deployment ⬜

## Blockers
- Container network policy blocks `predict-pm-amm.dev` and `api.devnet.solana.com`.
  Add both to the environment's allowed hosts to run live devnet tests.
