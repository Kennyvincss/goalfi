# Connected accounts: what GoalFi can verify automatically

A challenge with **verification = connected app** needs no human verifiers. GoalFi reads the value
from a source, turns each day's value into approved evidence, and settles the market itself. A
metric is only listed here if it has an official API, the data provably belongs to the participant
(they sign in), and showing daily totals to other participants is allowed.

| Metric (`appMetric`) | Source | Where the value comes from (verified field names) | Kind |
|---|---|---|---|
| `steps` | Google Health | `dataTypes/steps/dataPoints:dailyRollUp` → `rollupDataPoints[].steps.countSum` | per local day |
| `distance_km` | Google Health | `distance` rollup → `distance.millimetersSum` ÷ 1,000,000 | per local day |
| `running_km` | Google Health | `dataTypes/exercise/dataPoints` → workouts whose `exerciseType` is a running type (matched by name, e.g. RUNNING / TREADMILL_RUNNING, since the API doesn't list its values; walking and hiking excluded) → sum of `metricsSummary.distanceMillimeters` ÷ 1,000,000 | per local day |
| `floors` | Google Health | `floors` rollup → `floors.countSum` | per local day |
| `heart_zone_minutes` | Google Health | `active-zone-minutes` rollup → `sumInFatBurnHeartZone + sumInCardioHeartZone + sumInPeakHeartZone` | per local day |
| `workouts` | Google Health | `dataTypes/exercise/dataPoints` (list, filter `exercise.interval.civil_start_time`) → sessions with `activeDuration` ≥ 10 min | per local day |
| `wake_time` | Google Health (sleep scope) | `dataTypes/sleep/dataPoints` (filter `sleep.interval.civil_end_time`) → main sleep's `interval.civilEndTime`; naps ignored | per local day, lower is better |
| `github_contributions` | GitHub | GraphQL `viewer.contributionsCollection(from,to).contributionCalendar.weeks[].contributionDays[]{date, contributionCount}` | per calendar day |
| `lichess_games` | Lichess | `GET /api/games/user/{id}` (ndjson) → games whose `status` isn't created/started/aborted/noStart, at `lastMoveAt` | events per challenge day |
| `lichess_puzzles` | Lichess | `GET /api/puzzle/activity` (ndjson, scope `puzzle:read`) → entries with `win: true`, at `date` | events per challenge day |
| `community_members` | GoalFi | members of the challenge's GoalFi community | community level |
| `telegram_members` | Telegram | Bot API `getChatMemberCount` for the community's linked group | community level |

Sources of truth for the field names: Google's generated client (`googleapis`, `health/v4`), GitHub's
GraphQL schema (`@octokit/graphql-schema`) and OAuth flow (`@octokit/oauth-methods`), and Lichess's
OpenAPI spec (`@lichess-org/types`).

## Rules

- **Per local day** values are matched to a challenge by midday: a day counts when its midday (UTC) is
  inside the challenge window. App-verified challenges start at local midnight, so this picks exactly
  the right days for any timezone within ±12h.
- **Events** are counted in 24-hour challenge days starting at the challenge start (= local midnight).
- **Community levels** have one subject (the community). The latest count is recorded as a single
  live evidence row on the creator, and the value when the challenge ends decides the outcome. Use
  “reaches an amount” with 1 participant.
- **Lower-is-better** metrics (wake-up time) only work with “on N days” goals: a day counts when the
  value is at or below the target.
- Syncing continues for 2 hours after the end, and settlement waits for that plus the dispute window.
- One provider account can be connected to only one GoalFi user, so nobody counts twice.
- Disconnecting revokes access and deletes stored raw data. Evidence already used stays.

## Manipulation safeguards

Participants control the outcome of their own challenge, so a group could try to rig a market.
GoalFi makes that expensive and visible:

| Risk | Safeguard |
|---|---|
| Typing in fake steps or workouts | Google data is read **wearables-only** (`dataSourceFamily: users/me/dataSourceFamilies/google-wearables`, which per the API "excludes manually logged data"); sleeps with `metadata.manuallyEdited` are ignored. |
| Betting NO on yourself, then failing on purpose | GoalFi's trade screen offers participants and the creator only YES. Anyone holding NO can't join. NO buys by participants (through GoalFi, or found in their linked wallet when the challenge settles) are flagged publicly on the challenge page, and a participant who bet NO and failed loses 50 reputation (`PENALTY_SELF_BET`). The pm-AMM market itself is open on-chain, so a second, unlinked wallet can't be stopped, only limited (below). |
| Big profits from a rigged small market | Opening liquidity is capped by the creator's reputation (100 / 200 / 500, a quarter for easier-to-game metrics), which bounds what can be taken from the pool. GoalFi's trade screen caps a single buy at 20 + 20 per established participant (max 500; a quarter for easier-to-game metrics). Platform admins are exempt from the liquidity cap. |
| Fake accounts | Accounts younger than `TRUST_MIN_ACCOUNT_DAYS` (default 7) can't join challenges with a market. Community-size challenges count only established members (old enough, plus a linked wallet, Telegram account or reputation). One provider account can back only one GoalFi user. |
| Chess farming | Lichess games under 10 half-moves don't count; at most 3 games per opponent per challenge day count. |
| Weak metrics | GitHub contributions and community/Telegram member counts are labelled **Easier to game** in the builder, on suggestions, on the challenge page and in the trade panel, and get smaller market limits. |

## Considered and not supported

| Source | Why not |
|---|---|
| Push-ups, gym sets, reading, language apps (Duolingo), Goodreads | No official API that reports them (or the API was shut down). |
| Strava | Its API terms don't allow showing one user's data to other users. |
| Apple Health | No web API (data stays on the iPhone). |
| YouTube uploads | Possible via YouTube Data API, but it needs a sensitive Google scope (app verification) and its developer policies on storing and showing data weren't verifiable here. |
| WakaTime (coding time) | Has an OAuth API; its documentation couldn't be verified here. Candidate for a later version. |
| Screen time, revenue, sleep-only apps | No public API, or financial data too sensitive for public evidence. |
