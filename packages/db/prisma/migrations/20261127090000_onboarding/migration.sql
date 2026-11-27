-- Getting-started flow. Existing users are treated as already onboarded.
ALTER TABLE "users" ADD COLUMN "onboarded_at" TIMESTAMP(3);
UPDATE "users" SET "onboarded_at" = CURRENT_TIMESTAMP;
