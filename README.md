# GoalFi

**Turn real-life goals into prediction markets.** Communities create challenges, participants submit
evidence, appointed verifiers approve it, and anyone can trade the outcome on an on-chain
[Predict pm-AMM](https://predict-pm-amm.dev) market on Solana.

```
CREATE → PARTICIPATE → SUBMIT EVIDENCE → VERIFY → TRADE → RESOLVE → CLAIM
```

## Repository layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 website + REST API (`/api/*`) |
| `apps/bot` | Telegram bot + background workers ([setup](docs/TELEGRAM.md)) |
| `packages/services` | Business services shared by web API and bot (challenges, evidence, verification, disputes, resolution, transactions, Telegram linking) |
| `packages/core` | Pure business rules: verification, disputes, resolution gate, reputation, streaks, templates |
| `packages/chain` | pm-AMM integration on `@pm-amm/sdk@0.2.0` (config, market reads, quotes, tx builders, authority ops) |
| `packages/db` | Prisma 7 schema, migrations, seed |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) · [pm-AMM integration research](docs/PM_AMM_INTEGRATION.md) · [Roadmap](docs/ROADMAP.md) |

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env              # then fill in values
cp .env packages/db/.env
pnpm db:migrate                   # applies migrations (incl. integrity triggers)
pnpm db:seed                      # categories only, no fake data
pnpm dev                          # http://localhost:3000
```

Tests:

```bash
createdb goalfi_test && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/goalfi_test pnpm --filter @goalfi/db migrate:deploy
pnpm test        # core (48) + chain (23) unit, services (17) + bot (6) integration tests
pnpm typecheck
```

Integration tests use `TEST_DATABASE_URL` (default `postgres://…/goalfi_test`) and truncate it. Never point it at real data.

Run the bot + workers: `pnpm --filter @goalfi/bot start` (see [docs/TELEGRAM.md](docs/TELEGRAM.md)).

### Devnet (real on-chain loop)

```bash
pnpm --filter @goalfi/chain keygen      # devnet-only authority + trader keys in .devnet-keys/
# fund both with devnet SOL and mUSDC, then:
pnpm --filter @goalfi/chain devnet:e2e  # create → seed → quote → buy → sell → resolve → claim
```

The e2e script also verifies two behaviours the SDK doesn't document: curve orientation, and
the `winning_side` encoding. See `docs/PM_AMM_INTEGRATION.md`.

## Safety defaults

- Devnet only. Mainnet requires `GOALFI_ENABLE_MAINNET=I_UNDERSTAND_THE_RISKS`, plus security, legal and regulatory review.
- Non-custodial: users sign every trade/claim in their own wallet. The platform key only creates and resolves markets,
  and resolution is gated by `@goalfi/core` `evaluateResolution()`.
- Evidence content, verification votes and audit logs are append-only at the database level.
