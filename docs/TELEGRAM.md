# Telegram bot setup

The bot (`apps/bot`) is a persistent Node process: grammY bot + background workers
(scheduler, transaction reconciler, market price indexer, notification and announcement delivery).

## 1. Create the bot (BotFather)

1. `/newbot` → name **GoalFi**, pick a username (e.g. `GoalFiBot`) → copy the token into `TELEGRAM_BOT_TOKEN`.
2. `/setjoingroups` → **Enable** (needed for “Add GoalFi to a group”).
3. `/setdomain` → your website domain (required by the Telegram Login Widget used for sign-in).
4. Privacy mode can stay **enabled**: the bot only needs commands, which Telegram always delivers.
5. Set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (website) to the bot username.

## 2. Run

```bash
pnpm --filter @goalfi/bot start          # long polling (default)
```

Webhook mode: set `TELEGRAM_WEBHOOK_URL=https://<host>/telegram` and `TELEGRAM_WEBHOOK_SECRET`;
the process listens on `PORT` (default 8080) and exposes `/healthz`.

## 3. How group linking works

1. A signed-in user clicks **Add GoalFi to a group** on `/telegram`. The website creates a one-time,
   30-minute code and opens `https://t.me/<bot>?startgroup=<code>`.
2. Telegram asks the user to choose a group, and the **user** authorizes adding the bot (nothing is automatic).
3. Telegram posts `/start <code>` in the group from that user. The bot then verifies:
   - the code is valid, unused and unexpired;
   - the sender's Telegram account is linked to the GoalFi account that created the code;
   - `getChatMember(bot)` shows the bot is in the group;
   - `getChatMember(sender)` shows the sender is `creator` or `administrator`.
4. The group becomes (or re-attaches to) a GoalFi community. Members type `/join` to become community members.
5. If the bot is removed, the chat link is dropped but the community and its history remain.
   Supergroup migrations update the chat id automatically.

## Commands

`/start` `/help` `/dashboard` `/challenges` `/markets` `/leaderboard` `/submit` `/join`

## Notifications

- In-app notifications are mirrored to users who linked Telegram (per-type preferences honoured;
  trade confirmations stay in-app by default to avoid spam; nothing older than 24h is sent).
- Verifiers get **✅ Approve** quick actions. Rejections need a reason, so they link to the website.
  Quick approvals go through exactly the same verification service as the website.
- Community announcements (new challenge, challenge ended, resolved) go through a deduplicated outbox.
