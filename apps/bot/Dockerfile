# GoalFi Telegram bot + background workers (scheduler, tx reconciler, price indexer, notifications).
# Build from the REPOSITORY ROOT:  docker build -f apps/bot/Dockerfile -t goalfi-bot .
FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Install with the whole workspace manifest set (the bot imports workspace packages from source).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/chain/package.json packages/chain/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/services/package.json packages/services/
# Dev dependencies are needed at runtime: tsx runs the TypeScript sources, prisma generates the client.
RUN pnpm install --frozen-lockfile --filter "@goalfi/bot..." --prod=false

COPY packages packages
COPY apps/bot apps/bot
RUN pnpm --filter @goalfi/db generate

ENV NODE_ENV=production
# Polling mode needs no port. In webhook mode set TELEGRAM_WEBHOOK_URL and expose PORT (default 8080).
CMD ["pnpm", "--filter", "@goalfi/bot", "start"]
