# Predict pm-AMM — Integration Research

Source of truth for this document: the published npm package **`@pm-amm/sdk@0.2.0`**
(released 2026-09-24): its `README.md`, `llms.txt`, type declarations (`dist/index.d.ts`,
`dist/math.d.ts`) and the bundled Anchor IDL (`src/idl/pm_amm.json`, program `pm_amm` v0.1.0).

> The hosted docs at `https://predict-pm-amm.dev` (including `/hackathon.md` and
> `/api-reference.md`) were **not reachable** from the development container (blocked by
> the network policy). Everything below was verified against the SDK source and IDL instead.
> Items marked **[VERIFY ON DEVNET]** still need confirmation from a live devnet run
> (`pnpm --filter @goalfi/chain devnet:e2e`) or from the hosted docs.

## 1. Deployments

| | Program ID | Collateral mint |
|---|---|---|
| devnet | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` | `3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ` (mock USDC "mUSDC", 6 dp) |
| mainnet-beta | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle USDC, 6 dp) |

The program ID is identical on both clusters; **only the collateral mint differs**. GoalFi
therefore binds `(cluster, rpcUrl, collateralMint)` together in a single frozen config object
(`packages/chain/src/config.ts`) and refuses to start if they disagree — devnet and mainnet
addresses can never be mixed.

Protocol constants exported by the SDK: `SWAP_FEE_BPS = 200` (2%),
`PROTOCOL_DAO = 4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph`,
`CU = { DEFAULT: 400000, HEAVY: 1400000 }`.

**mUSDC faucet:** the SDK has no faucet instruction and the mock mint's authority is not
GoalFi's. How testers obtain mUSDC is documented on the hosted site **[VERIFY — hosted docs]**.

## 2. Package & peer dependencies

```
@pm-amm/sdk@0.2.0
peer: @solana/web3.js ^1.98.4   (NOT 2.x/3.x — the latest web3.js on npm is 3.x; we pin 1.99.0)
peer: @anchor-lang/core ^1.0.1
peer: @solana/spl-token ^0.4.14
```

- Exactly one copy of each peer must be installed (two web3.js copies break `instanceof PublicKey`).
- Browser needs a `Buffer` polyfill (Next.js provides one).
- `@anchor-lang/core` is CJS: importing the SDK ESM build from raw Node fails on the `BN`
  named import. Server code (bot, scripts) uses the **CJS build** or runs through a bundler.

## 3. SDK surface we use

`PmAmmClient.readOnly(connection, programId, collateralMint)` — reads, PDAs, `ix.*` builders.
`PmAmmClient.fromProvider(anchorProvider, programId, collateralMint)` — adds `send.*`, `flows.*`.

| GoalFi feature | SDK call | On-chain instruction | Signer |
|---|---|---|---|
| Create binary market | `ix.initializeMarket({authority, marketId, endTs, name, initialPriceBps})` | `initialize_market` | GoalFi market authority |
| Seed / add liquidity | `ix.depositLiquidity` / `send.depositLiquidity(market, usdc)` | `deposit_liquidity` | anyone (creator, community) |
| Buy YES / NO | `send.swap(market, "usdcToYes"\|"usdcToNo", amountMicro, minOutMicro)` | `swap` | trader |
| Sell YES / NO | `send.swap(market, "yesToUsdc"\|"noToUsdc", …)` | `swap` | trader |
| Exit a full pair | `send.redeemPair(market, amountMicro)` | `redeem_pair` | holder |
| Remove liquidity | `send.withdrawLiquidity(market, sharesQ64)` | `withdraw_liquidity` | LP |
| LP residuals | `send.claimLpResiduals(market)` | `claim_lp_residuals` | LP |
| Resolve | `ix.resolveMarket({signer, market, side})` | `resolve_market` | **market.authority only, after `end_ts`** |
| Claim winnings | `send.claimWinnings(market)` | `claim_winnings` | holder (burns own tokens) |
| Community-funded launch | `send.createVault / vaultCommit / launchVaultMarket / claimCommitter / refundCommit` | commitment vault ixs | various |
| Multi-outcome | `flows.createGroup`, `flows.resolveGroup`, `flows.claimAllGroupWinnings` | group ixs | authority / holder |
| 1v1 / small-group stakes | `send.createBetVault / betCommit / launchBetVault / resolveBetVault / settleBetVault / claimBet / voidBetVault / refundBet` | bet vault ixs | various |
| Reads | `fetchMarket`, `fetchAllMarkets(443)`, `fetchLpPosition`, `fetchVault`, `fetchGroup`, `fetchBetVault`… | — | none |
| Price math | `@pm-amm/sdk/math`: `i80f48ToNumber`, `priceFromReserves`, `estimateSwapOutput`, `poolValue` | — | none |
| Error decoding | `mapAnchorError(err)` | — | — |

## 4. Facts that shape GoalFi's design

1. **Resolution authority is `market.authority`** = the signer of `initialize_market`, and it
   can only resolve after `end_ts` (`MarketNotExpired` 6003). → GoalFi creates every
   challenge market with a **platform-held market-authority keypair**. The backend
   runs the human-verification prerequisites (§14 of the spec) in `@goalfi/core`'s
   `evaluateResolution()` and only then signs `resolve_market`. A creator's wallet
   never holds resolution power, so nobody can bypass GoalFi's verification rules.
2. **Trading stops at `end_ts`** (`MarketExpired` 6002). We set `end_ts` = challenge end
   date, so trading closes when the challenge closes. Verification and disputes run
   after that, while trading is closed, and resolution follows. This removes the
   information-leak problem of trading during review.
3. **Market id is caller-chosen (u64)** and the market PDA is
   `["market", u64le(id)]`. `send.createMarket` picks a random id internally, so GoalFi
   builds `initialize_market` itself with a **pre-generated id stored in the DB before sending**.
   If the process crashes after sending, recovery just checks whether that PDA
   exists (idempotent create).
4. **Seed price**: `initial_price_bps` ∈ {0 (=50/50)} ∪ [100, 9900]. It applies at
   the first `deposit_liquidity`. A market without liquidity cannot trade.
5. **Fees**: 2% on the USDC leg of every USDC↔outcome swap (off the input on buys, off the
   output on sells), split 50/50 between the protocol DAO and **`market.authority`** (the
   creator-fee recipient). Because GoalFi's platform key is the authority, creator fees accrue
   to the platform treasury ATA. YES↔NO swaps are free.
6. **Liquidity decays**: `L_eff = L₀·√(T−t)`. Depth shrinks toward expiry, which is the
   intended pm-AMM behaviour (uniform LVR). The UI shows "effective liquidity" and warns
   that price impact grows near the deadline. `accrue` (permissionless) releases decayed
   liquidity to LPs as YES+NO residuals.
   **[VERIFY ON DEVNET]** the time unit of `T−t` used on-chain. `chain/src/market.ts`
   computes `L_eff` in seconds. A self-check compares the computed price at open with
   `initial_price_bps`. **Quotes do not depend on this**: they come from
   `simulateTransaction` of the real swap instruction (see 7).
7. **Quotes**: `math.estimateSwapOutput` is float64 and **fee-unaware**. GoalFi shows a
   fee-adjusted math estimate instantly, then replaces it with an **authoritative quote
   from `connection.simulateTransaction`** of the exact `swap` ix the user will sign (post
   token balances). `minOutput` = simulated output × (1 − slippage).
8. **Claims**: `claim_winnings` burns *both* sides of the signer's own token accounts and pays 1
   USDC per winning token. It is wallet-signed, so nobody can claim someone else's
   winnings (enforced on-chain). `redeem_pair` (1 YES + 1 NO → 1 USDC) works any time.
9. **Positions are SPL balances** of `yesMint(market)` / `noMint(market)` in the holder's ATAs.
   The portfolio reads those balances on-chain. The DB only keeps a history of confirmed
   transactions (for "amount invested"); it never stores a balance.
10. **No price history on-chain.** GoalFi's indexer snapshots reserves/price periodically
    and after every confirmed trade (`MarketSnapshot` table). Volume comes from
    confirmed swap transactions indexed by signature.

## 5. Limitations & how GoalFi handles them

| Limitation in pm-AMM 0.2.0 | GoalFi approach |
|---|---|
| A standalone **binary market cannot be cancelled/voided**. Only resolve YES/NO exists. | A suspended challenge resolves according to its published rules (default: NO = "goal not achieved"), stated up front in the market rules. Holders can also `redeem_pair` at any time. Bet vaults have a real `void_bet_vault` fallback. |
| Resolution requires `end_ts` to have passed. | Disputes and review happen after trading closes. Early success can't resolve early (documented). |
| Commitment vault durations: commit 1 min–7 days; market 5 min–30 days (`6034`/`6035`). | Challenge form validates these bounds when "community-funded" is selected. Plain `initialize_market` duration bounds: `InvalidDuration` 6012, exact bounds **[VERIFY ON DEVNET]**. We cap challenges at 30 days for markets. |
| Commitment vault v1 `claim_committer` returns the commit 1:1 (LP shares are a "v2" item). | Presented as "crowd-set opening odds + refundable launch commitment", not as an LP yield product. |
| Commitment-vault resolution authority after `launch_vault_market` is not documented in the SDK. | **[VERIFY ON DEVNET]**: we create vaults with the platform authority key and read `market.authority` after launch before enabling the vault path in production. |
| Multi-outcome: groups support 2–32 legs (author flow), vault groups 2–8; legs seeded at `10000/N` bps. Per-leg custom seeds are not supported for author-created groups. | Multi-outcome challenges use `flows.createGroup` with equal seeds, then `flows.resolveGroup(winningLeg)`; `winningLeg = null` cancels (all legs NO). |
| Bet vault allowlist ≤ 8 keys; resolver = a single key. | Used only for 1v1 / small-group "direct competitions" with `resolver` = platform authority, `voidGraceSecs` = review window + margin. |
| `estimateSwapOutput` is approximate float math. | Display only. Execution uses simulation + `minOutput`. |
| Creator fee goes to `market.authority`, not to the human challenge creator. | Platform treasury. A creator revenue share would need off-chain accounting (out of MVP scope). |

## 6. Transaction lifecycle in GoalFi

**User-signed** (swap, deposit, commit, claim):
1. The client builds the ix with the SDK and the wallet signs and sends it.
2. The client POSTs `{signature, kind, marketId}` to `/api/transactions`. The row is inserted as `PENDING`; `signature` is UNIQUE, which makes it idempotent.
3. The backend `verifyProgramTransaction()` fetches the tx at `confirmed` and checks:
   no error, fee payer equals the user's linked wallet, the tx invokes the pm-AMM program,
   and it touches the expected market account.
4. The row becomes `CONFIRMED` (or `FAILED`), a market snapshot is taken, notifications are sent.
   **No row is ever marked successful before chain confirmation.** A reconciler retries
   stale `PENDING` rows.

**Platform-signed** (create market, resolve):
1. An intent row is written first (`Market.status = CREATING`, chosen `onchainMarketId`).
2. The backend signs with the authority key, sends, and confirms.
3. On confirmation, address and signature are stored. On crash or timeout, the reconciler
   checks the PDA account state (`fetchMarket`: exists / `resolved` + `winningSide`).
   That is idempotent, so double-creation or double-resolution is impossible.
