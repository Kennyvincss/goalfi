-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('MANUAL', 'CONNECTED_APP');

-- CreateEnum
CREATE TYPE "FitnessProvider" AS ENUM ('GOOGLE_HEALTH');

-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "fitnessDailyTarget" INTEGER,
ADD COLUMN     "fitnessMetric" TEXT,
ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "fitness_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "FitnessProvider" NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fitness_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fitness_daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "FitnessProvider" NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitness_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fitness_connections_userId_provider_key" ON "fitness_connections"("userId", "provider");

-- CreateIndex
CREATE INDEX "fitness_daily_userId_metric_date_idx" ON "fitness_daily"("userId", "metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fitness_daily_userId_provider_date_metric_key" ON "fitness_daily"("userId", "provider", "date", "metric");

-- AddForeignKey
ALTER TABLE "fitness_connections" ADD CONSTRAINT "fitness_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fitness_daily" ADD CONSTRAINT "fitness_daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

