-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "marketConfig" JSONB,
ADD COLUMN     "marketQuestion" TEXT;

-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "fundedAmount" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "telegram_outbox" (
    "id" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "buttons" JSONB,
    "dedupKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_outbox_dedupKey_key" ON "telegram_outbox"("dedupKey");

-- CreateIndex
CREATE INDEX "telegram_outbox_sentAt_createdAt_idx" ON "telegram_outbox"("sentAt", "createdAt");

