-- Market integrity: self-bet flag + penalty, anti-farming bucket for activity events.
ALTER TYPE "ReputationActivity" ADD VALUE 'PENALTY_SELF_BET';
ALTER TABLE "participants" ADD COLUMN "betAgainstAt" TIMESTAMP(3);
ALTER TABLE "activity_events" ADD COLUMN "groupKey" TEXT;
