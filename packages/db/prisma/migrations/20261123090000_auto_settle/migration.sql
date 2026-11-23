-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "autoSettle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewDeadlineHours" INTEGER;

-- AlterTable
ALTER TABLE "evidence" ADD COLUMN     "autoDecision" TEXT;

