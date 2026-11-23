-- Generalize "connected fitness" into connected accounts (Google Health, GitHub, Lichess).
-- Renames keep any existing rows.

ALTER TYPE "FitnessProvider" RENAME TO "AccountProvider";
ALTER TYPE "AccountProvider" ADD VALUE 'GITHUB';
ALTER TYPE "AccountProvider" ADD VALUE 'LICHESS';

ALTER TABLE "fitness_connections" RENAME TO "connected_accounts";
ALTER TABLE "connected_accounts" RENAME CONSTRAINT "fitness_connections_pkey" TO "connected_accounts_pkey";
ALTER TABLE "connected_accounts" RENAME CONSTRAINT "fitness_connections_userId_fkey" TO "connected_accounts_userId_fkey";
ALTER INDEX "fitness_connections_userId_provider_key" RENAME TO "connected_accounts_userId_provider_key";
ALTER TABLE "connected_accounts" ADD COLUMN "externalId" TEXT, ADD COLUMN "externalName" TEXT;

ALTER TABLE "fitness_daily" RENAME TO "activity_daily";
ALTER TABLE "activity_daily" RENAME CONSTRAINT "fitness_daily_pkey" TO "activity_daily_pkey";
ALTER TABLE "activity_daily" RENAME CONSTRAINT "fitness_daily_userId_fkey" TO "activity_daily_userId_fkey";
ALTER INDEX "fitness_daily_userId_metric_date_idx" RENAME TO "activity_daily_userId_metric_date_idx";
ALTER INDEX "fitness_daily_userId_provider_date_metric_key" RENAME TO "activity_daily_userId_provider_date_metric_key";

ALTER TABLE "challenges" RENAME COLUMN "fitnessMetric" TO "appMetric";
ALTER TABLE "challenges" RENAME COLUMN "fitnessDailyTarget" TO "appDailyTarget";
ALTER TABLE "challenges" ALTER COLUMN "appDailyTarget" SET DATA TYPE DOUBLE PRECISION;

CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AccountProvider" NOT NULL,
    "metric" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activity_events_userId_metric_occurredAt_idx" ON "activity_events"("userId", "metric", "occurredAt");
CREATE UNIQUE INDEX "activity_events_userId_provider_metric_externalId_key" ON "activity_events"("userId", "provider", "metric", "externalId");
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
