# Mainnet readiness review

GoalFi runs on **Solana devnet with test tokens** today. Moving to mainnet means real USDC changes hands
on markets whose outcomes people can partly influence. This review lists what is already in place, what
must be done before launch, and who does it. It is a planning document, not legal advice.

Status: ✅ done · 🟡 partly done · ❌ not started

## 1. Legal and regulatory (blocking: do first)

Prediction markets on real-world events are regulated in most countries, sometimes as gambling,
sometimes as financial derivatives (e.g. event contracts under the US CFTC). Rules differ by country.

| Item | Status | Notes |
|---|---|---|
| Legal opinion on operating real-money prediction markets in your target countries | ❌ | Needs a lawyer who knows gambling and derivatives law. This decides everything below. |
| Licences or a regulated partner, if required | ❌ | Some places require a gambling or exchange licence; others ban it outright. |
| Geoblocking of restricted countries | ❌ | Block trading (not necessarily challenges) by IP and declared country. |
| Identity checks (KYC) and age 18+ verification for traders | ❌ | Terms already say 18+, but nothing checks it. KYC is usually required for real money. |
| Anti-money-laundering policy and sanctions screening of wallets | ❌ | Often required alongside KYC. |
| Terms of service and privacy policy reviewed by a lawyer | 🟡 | Plain-language drafts exist at `/terms` and `/privacy`. |
| Tax and reporting obligations | ❌ | Depends on where you operate. |

## 2. Market integrity (who decides outcomes)

GoalFi resolves every market with its own **market-authority key**, so users trust GoalFi to resolve honestly.

| Item | Status | Notes |
|---|---|---|
| Outcomes computed from published rules and evidence, with a dispute window | ✅ | Resolution gate in `@goalfi/core`; admin overrides need a written reason and are audited. |
| Protection against self-betting, fake data and fake accounts | ✅ | No NO-bets by participants via GoalFi, wallet scan at settlement, wearables-only data, account age, market limits. See CONNECTED_ACCOUNTS.md. |
| Hosts and verifiers can't trade on the markets they run or verify | ✅ | Blocked on GoalFi's trade screen; a buy by any of them recorded by GoalFi is flagged publicly and penalized. |
| Unlinked second wallets can still bet against their own challenge or trade as a host | 🟡 | Can't be blocked on an open chain; limited by liquidity caps. Consider smaller caps on mainnet. |
| Public record of hosts and participants | ✅ | Profiles show track record, fair-play flags and badges. |
| Written resolution policy for edge cases (cancelled challenges, outages, disputed data) | ❌ | Publish it before launch. |
| Independent review of disputed or high-value resolutions | ❌ | e.g. a second admin must approve overrides above a threshold. |

## 3. Keys and smart contracts

| Item | Status | Notes |
|---|---|---|
| pm-AMM program audited | ❓ | GoalFi uses the Predict pm-AMM program; it doesn't deploy its own. Ask the Predict team for audit reports before trusting it with real money. |
| Market-authority key kept out of the web server | ❌ | Today it is an environment variable on Vercel (a "hot key"). For mainnet, use a hardware-backed signer (cloud KMS or HSM) or a separate signing service with alerts, and limit what it can sign. |
| Separate keys for devnet and mainnet | 🟡 | Supported by config; make sure the mainnet key is new and never used on devnet. |
| Key-compromise plan | ❌ | Who rotates the key, how open markets are handled, how users are told. |
| Users keep their own funds (non-custodial) | ✅ | Users sign every trade in their own wallet; GoalFi never holds their USDC. |
| Mainnet switch locked by default | ✅ | `GOALFI_CLUSTER=mainnet-beta` refuses to start unless `GOALFI_ENABLE_MAINNET=I_UNDERSTAND_THE_RISKS` is also set. |
| Real USDC mint and program ID verified | ✅ | Pinned in `@goalfi/chain` (`PM_AMM_DEPLOYMENTS`). |

## 4. Money limits

| Item | Status | Notes |
|---|---|---|
| Opening-liquidity caps by reputation, smaller for easy-to-game metrics | ✅ | 100 / 200 / 500 (25% for easy-to-game). Revisit the numbers for real money. |
| Per-trade cap on GoalFi's trade screen | ✅ | Grows with established participants. |
| Platform-wide exposure cap and kill switch | ❌ | A setting that pauses new markets and trading through GoalFi in an emergency. |
| Platform admins exempt from the liquidity cap | 🟡 | Fine on devnet; consider removing on mainnet. |

## 5. Security and operations

| Item | Status | Notes |
|---|---|---|
| Independent security review / penetration test of the web app and API | ❌ | Focus on auth, the cron and webhook endpoints, uploads, and resolution. |
| Secrets rotation plan (session, cron, webhook, account-token keys) | ❌ | Rotating `ACCOUNT_TOKEN_KEY` disconnects everyone; document the procedure. |
| Paid, reliable Solana RPC provider with monitoring | ❌ | The public RPC is rate-limited. |
| Error monitoring and alerts (failed resolutions, scheduler stopped, low authority SOL) | 🟡 | System status shows these; nothing pages anyone yet. |
| Database backups and a tested restore | ❌ | Check your Neon plan's point-in-time restore. |
| Rate limits on sign-up, trading submissions and uploads | ✅ | Postgres-backed rate limits. |
| Audit log of admin and money-related actions | ✅ | Append-only audit log. |

## 6. Accounts, data and support

| Item | Status | Notes |
|---|---|---|
| Own domain | ❌ | Needed for Google verification and trust. |
| Google sign-in verification (removes the "unverified app" warning and 100-user cap) | ❌ | Needs the domain, privacy policy, demo video. |
| Account deletion and data export on request | 🟡 | Policy says "contact us"; a self-serve button is better. |
| Support channel and response time | ❌ | Set `GOALFI_CONTACT_EMAIL` and decide who answers. |
| New-account rule back on (`TRUST_MIN_ACCOUNT_DAYS` not 0) | ❌ until you remove the testing override | System status warns while it's 0. |

## 7. Suggested order

1. Legal opinion (section 1). If real-money markets aren't allowed where you operate, consider launching
   challenges with **points instead of money**, or markets only where permitted.
2. Domain, Google verification, support contact, `TRUST_MIN_ACCOUNT_DAYS` back to default.
3. Key management (KMS/HSM signer), kill switch, exposure cap, monitoring and alerts.
4. Security review and pm-AMM audit confirmation.
5. Small, invite-only mainnet beta with low caps; widen gradually.

Admin → System status shows a **Launch readiness** section with the checks GoalFi can do by itself.
