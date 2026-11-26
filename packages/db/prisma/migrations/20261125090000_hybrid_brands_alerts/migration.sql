-- "Watch or proof" verification, Withings + Oura accounts, weekly Telegram ideas, market price alerts.
ALTER TYPE "VerificationMethod" ADD VALUE 'HYBRID';
ALTER TYPE "AccountProvider" ADD VALUE 'WITHINGS';
ALTER TYPE "AccountProvider" ADD VALUE 'OURA';
ALTER TABLE "communities" ADD COLUMN "weeklyIdeas" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "markets" ADD COLUMN "lastAlertPrice" DOUBLE PRECISION;
