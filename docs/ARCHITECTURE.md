# GoalFi — Technical Architecture

```
┌────────────────────────── apps/web (Next.js, Vercel) ──────────────────────────┐
│  UI (App Router, Tailwind, shadcn-style components, Recharts)                  │
│  Wallet adapter (Phantom/Solflare) ── signs user txs built with @pm-amm/sdk    │
│  REST API  /api/*  (route handlers) ── auth, challenges, evidence, verification │
│                                        disputes, markets, transactions          │
└──────────────┬───────────────────────────────┬──────────────────────────────────┘
               │ Prisma                        │ @goalfi/chain (server side)
        ┌──────▼──────┐                 ┌──────▼──────────────────────────────┐
        │ PostgreSQL  │                 │ Solana devnet / pm-AMM program      │
        └──────▲──────┘                 │ GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5x… │
               │                        └──────▲──────────────────────────────┘
┌──────────────┴──────── apps/bot (persistent Node: grammY + workers) ───────────┐
│  Telegram bot (commands, group linking, announcements, quick review actions)   │
│  Workers: notification dispatch, tx reconciler, market indexer (snapshots)     │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@goalfi/core` | Pure business rules: verification thresholds, dispute gating, **resolution prerequisites**, reputation points, streaks, challenge state machine, validation schemas. No I/O. | zod |
| `@goalfi/db` | Prisma schema, migrations, client singleton. | prisma |
| `@goalfi/chain` | Everything Solana: cluster config, pm-AMM client factories, market views, quotes, platform-authority operations (create/resolve), tx verification. No business rules. | @pm-amm/sdk, web3.js 1.x, anchor, spl-token |
| `apps/web` | Website + REST API. Orchestrates core + db + chain. | all |
| `apps/bot` | Telegram bot + background workers. | core, db, chain |

Business logic (core) and blockchain logic (chain) never import each other. Only the app layer
composes them. Example: `resolveChallenge()` in the web API loads state from the DB, calls
`core.evaluateResolution()`, and only if `ok` calls `chain.resolveMarketAsAuthority()`.

## Identity & auth

- **Accounts without wallets**: email + password (scrypt), or **Telegram Login** (HMAC-SHA256 over
  the auth payload with `SHA256(bot_token)` as key; `auth_date` freshness ≤ 24h).
- **Wallet linking**: Sign-In-With-Solana-style message with a one-time server nonce, verified with
  ed25519 (`tweetnacl`). One wallet per user (unique). Trading requires a linked wallet, and the
  backend checks the tx fee payer against it.
- Sessions: random 32-byte token in an httpOnly, SameSite=Lax, Secure cookie; only the SHA-256 of
  the token is stored in `Session`.
- RBAC: platform role on `User.role` (`USER`/`PLATFORM_ADMIN`). Community role on `CommunityMember.role`
  (`OWNER`/`ADMIN`/`VERIFIER`/`MEMBER`). Per-challenge role on `ChallengeRole` (`ADMIN`/`VERIFIER`).
  Every mutation is authorized server-side.

## Market authority & keys

- One **platform market-authority keypair** per cluster (`GOALFI_MARKET_AUTHORITY_SECRET`, base58,
  env var only; KMS/HSM before mainnet). It signs only `initialize_market`, `resolve_market` and
  group/vault resolution, and resolution runs only after `core.evaluateResolution()` passes and an
  authorized challenge admin confirms.
- Creators fund initial liquidity from **their own wallet** (`deposit_liquidity`). GoalFi never
  custodies user funds and has no custodial or burner wallets in the MVP.
- Mainnet trading is disabled by config (`GOALFI_CLUSTER=mainnet-beta` requires
  `GOALFI_ENABLE_MAINNET=I_UNDERSTAND_THE_RISKS` and legal sign-off).

## Evidence integrity

- Files go to object storage (Supabase Storage in prod, local disk in dev) under
  content-addressed keys. `Evidence.contentHash` (SHA-256 of the file bytes) is recorded at submission.
- A Postgres trigger blocks `UPDATE` of content columns (`fileUrl`, `contentHash`, `description`,
  `links`, `submittedAt`) on `Evidence`. Only `status` can change. A correction is a new submission
  that references the old one via `supersedesId`.
- Verifications are unique per `(evidenceId, verifierId)`, so duplicate votes are impossible at the DB level.

## Resolution prerequisites (enforced by backend, not the AMM)

`core.evaluateResolution()` returns `ok` only if all of these hold:
challenge ended, market `end_ts` passed, no evidence `PENDING`/`UNDER_REVIEW`, no open dispute,
dispute window elapsed since the last decision, success criteria evaluated from approved evidence,
and the resolver is a challenge admin. Admin confirmation → `chain.resolveMarketAsAuthority()` →
store winning outcome, timestamp, resolver, signature.

## Reliability

- `Transaction.signature` is UNIQUE, so submissions are idempotent.
- Platform-signed ops write intent rows first and reconcile from PDA state.
- The indexer and reconciler run in `apps/bot` (persistent process). The website stays stateless.
