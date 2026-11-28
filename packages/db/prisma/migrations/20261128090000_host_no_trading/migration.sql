-- Hosts (creator and co-admins) may not trade on their own challenge's market.
ALTER TYPE "ReputationActivity" ADD VALUE 'PENALTY_HOST_TRADED';
ALTER TABLE "markets" ADD COLUMN "hostTradedAt" TIMESTAMP(3);
