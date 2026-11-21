-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "TelegramLinkPurpose" AS ENUM ('LINK_ACCOUNT', 'LINK_GROUP');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'ADMIN', 'VERIFIER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'PENDING_MARKET', 'UPCOMING', 'ACTIVE', 'IN_REVIEW', 'RESOLVING', 'RESOLVED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChallengeVisibility" AS ENUM ('PUBLIC', 'COMMUNITY', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ChallengeKind" AS ENUM ('PERSONAL', 'GROUP', 'COMPETITION');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "ChallengeRoleType" AS ENUM ('ADMIN', 'VERIFIER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('JOINED', 'COMPLETED', 'FAILED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "VerificationDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'UPHELD', 'DISMISSED');

-- CreateEnum
CREATE TYPE "Cluster" AS ENUM ('DEVNET', 'MAINNET');

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('BINARY', 'MULTI_OUTCOME', 'COMMITMENT_VAULT', 'BET_VAULT');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('CREATING', 'AWAITING_LIQUIDITY', 'FUNDING', 'OPEN', 'CLOSED', 'RESOLVING', 'RESOLVED', 'FAILED');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('CREATE_MARKET', 'DEPOSIT_LIQUIDITY', 'WITHDRAW_LIQUIDITY', 'BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'REDEEM_PAIR', 'RESOLVE_MARKET', 'CLAIM_WINNINGS', 'CLAIM_LP_RESIDUALS', 'VAULT_COMMIT', 'VAULT_LAUNCH', 'VAULT_CLAIM', 'VAULT_REFUND');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReputationActivity" AS ENUM ('CHALLENGE_COMPLETED', 'EVIDENCE_APPROVED', 'STREAK_MILESTONE', 'CHALLENGE_CREATED_SUCCESSFUL', 'FAIR_VERIFICATION', 'PENALTY_EVIDENCE_OVERTURNED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CHALLENGE_NEW', 'CHALLENGE_INVITE', 'CHALLENGE_STARTING', 'CHALLENGE_ENDING', 'EVIDENCE_RECEIVED', 'EVIDENCE_APPROVED', 'EVIDENCE_REJECTED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'MARKET_UPDATE', 'TRADE_CONFIRMED', 'CHALLENGE_RESOLVED', 'WINNINGS_AVAILABLE', 'CLAIM_CONFIRMED', 'STREAK_REMINDER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "telegram_id" BIGINT,
    "telegramUsername" TEXT,
    "wallet_address" TEXT,
    "walletLinkedAt" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "bio" TEXT,
    "reputation_score" INTEGER NOT NULL DEFAULT 0,
    "role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "suspendedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_nonces" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" "TelegramLinkPurpose" NOT NULL,
    "userId" TEXT NOT NULL,
    "communityId" TEXT,
    "telegramChatId" BIGINT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "creator_id" TEXT NOT NULL,
    "telegram_chat_id" BIGINT,
    "telegramTitle" TEXT,
    "telegramLinkedAt" TIMESTAMP(3),
    "announcement" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_invites" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "community_id" TEXT,
    "creator_id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "success_criteria" TEXT NOT NULL,
    "successRule" JSONB NOT NULL,
    "participationReq" TEXT,
    "evidenceReq" TEXT NOT NULL,
    "kind" "ChallengeKind" NOT NULL DEFAULT 'GROUP',
    "visibility" "ChallengeVisibility" NOT NULL DEFAULT 'PUBLIC',
    "recurrence" "Recurrence" NOT NULL DEFAULT 'NONE',
    "parentChallengeId" TEXT,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "disputeWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxParticipants" INTEGER,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "marketEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rulesConfirmedAt" TIMESTAMP(3),
    "outcome" "Outcome",
    "resultSummary" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "suspendedReason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_roles" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChallengeRoleType" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'JOINED',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" TEXT[],
    "progressValue" DECIMAL(18,4),
    "activityDate" DATE,
    "contentHash" TEXT NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "supersedesId" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_files" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "verifier_id" TEXT NOT NULL,
    "decision" "VerificationDecision" NOT NULL,
    "reason" TEXT,
    "round" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "final_decision" "EvidenceStatus",
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "cluster" "Cluster" NOT NULL,
    "programId" TEXT NOT NULL,
    "collateralMint" TEXT NOT NULL,
    "market_type" "MarketType" NOT NULL,
    "onchainId" TEXT NOT NULL,
    "market_address" TEXT,
    "groupAddress" TEXT,
    "vaultAddress" TEXT,
    "authority" TEXT NOT NULL,
    "initial_price" INTEGER NOT NULL,
    "liquidityTargetUsdc" BIGINT NOT NULL DEFAULT 0,
    "liquidity" BIGINT NOT NULL DEFAULT 0,
    "endTs" TIMESTAMP(3) NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'CREATING',
    "winning_outcome" INTEGER,
    "creationSignature" TEXT,
    "transaction_signature" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_outcomes" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "legMarketAddress" TEXT,
    "legOnchainId" TEXT,

    CONSTRAINT "market_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_snapshots" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeIdx" INTEGER NOT NULL DEFAULT 0,
    "yesPrice" DOUBLE PRECISION NOT NULL,
    "reserveYes" DOUBLE PRECISION NOT NULL,
    "reserveNo" DOUBLE PRECISION NOT NULL,
    "lEff" DOUBLE PRECISION NOT NULL,
    "poolValue" DOUBLE PRECISION NOT NULL,
    "slot" BIGINT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "outcome" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "sharesBought" BIGINT NOT NULL DEFAULT 0,
    "sharesSold" BIGINT NOT NULL DEFAULT 0,
    "usdcReceived" BIGINT NOT NULL DEFAULT 0,
    "transaction_signature" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "market_id" TEXT,
    "transaction_signature" TEXT NOT NULL,
    "transaction_type" "TxKind" NOT NULL,
    "outcome" INTEGER,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "outputAmount" BIGINT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "slot" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_type" "ReputationActivity" NOT NULL,
    "points" INTEGER NOT NULL,
    "refId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streaks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "period" "Recurrence" NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "dedupKey" TEXT,
    "read_status" TIMESTAMP(3),
    "telegramSentAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "web" BOOLEAN NOT NULL DEFAULT true,
    "telegram" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_nonces_nonce_key" ON "wallet_nonces"("nonce");

-- CreateIndex
CREATE INDEX "wallet_nonces_userId_idx" ON "wallet_nonces"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_key" ON "telegram_link_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "communities_slug_key" ON "communities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "communities_telegram_chat_id_key" ON "communities"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "communities_visibility_idx" ON "communities"("visibility");

-- CreateIndex
CREATE INDEX "community_members_user_id_idx" ON "community_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_community_id_user_id_key" ON "community_members"("community_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_invites_code_key" ON "community_invites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_slug_key" ON "challenges"("slug");

-- CreateIndex
CREATE INDEX "challenges_status_end_date_idx" ON "challenges"("status", "end_date");

-- CreateIndex
CREATE INDEX "challenges_categoryId_idx" ON "challenges"("categoryId");

-- CreateIndex
CREATE INDEX "challenges_community_id_idx" ON "challenges"("community_id");

-- CreateIndex
CREATE INDEX "challenges_creator_id_idx" ON "challenges"("creator_id");

-- CreateIndex
CREATE INDEX "challenge_roles_userId_idx" ON "challenge_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_roles_challengeId_userId_role_key" ON "challenge_roles"("challengeId", "userId", "role");

-- CreateIndex
CREATE INDEX "participants_user_id_idx" ON "participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_challenge_id_user_id_key" ON "participants"("challenge_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_supersedesId_key" ON "evidence"("supersedesId");

-- CreateIndex
CREATE INDEX "evidence_challenge_id_status_idx" ON "evidence"("challenge_id", "status");

-- CreateIndex
CREATE INDEX "evidence_user_id_idx" ON "evidence"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_storageKey_key" ON "evidence_files"("storageKey");

-- CreateIndex
CREATE INDEX "verifications_verifier_id_idx" ON "verifications"("verifier_id");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_evidence_id_verifier_id_round_key" ON "verifications"("evidence_id", "verifier_id", "round");

-- CreateIndex
CREATE INDEX "disputes_evidence_id_status_idx" ON "disputes"("evidence_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "markets_challenge_id_key" ON "markets"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "markets_market_address_key" ON "markets"("market_address");

-- CreateIndex
CREATE UNIQUE INDEX "markets_groupAddress_key" ON "markets"("groupAddress");

-- CreateIndex
CREATE UNIQUE INDEX "markets_vaultAddress_key" ON "markets"("vaultAddress");

-- CreateIndex
CREATE UNIQUE INDEX "markets_creationSignature_key" ON "markets"("creationSignature");

-- CreateIndex
CREATE UNIQUE INDEX "markets_transaction_signature_key" ON "markets"("transaction_signature");

-- CreateIndex
CREATE INDEX "markets_status_endTs_idx" ON "markets"("status", "endTs");

-- CreateIndex
CREATE UNIQUE INDEX "markets_cluster_programId_onchainId_key" ON "markets"("cluster", "programId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "market_outcomes_legMarketAddress_key" ON "market_outcomes"("legMarketAddress");

-- CreateIndex
CREATE UNIQUE INDEX "market_outcomes_marketId_index_key" ON "market_outcomes"("marketId", "index");

-- CreateIndex
CREATE INDEX "market_snapshots_marketId_takenAt_idx" ON "market_snapshots"("marketId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "positions_user_id_market_id_outcome_key" ON "positions"("user_id", "market_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transaction_signature_key" ON "transactions"("transaction_signature");

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_market_id_created_at_idx" ON "transactions"("market_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "reputation_user_id_idx" ON "reputation"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_user_id_activity_type_refId_key" ON "reputation"("user_id", "activity_type", "refId");

-- CreateIndex
CREATE INDEX "streaks_userId_idx" ON "streaks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "streaks_userId_challengeId_key" ON "streaks"("userId", "challengeId");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_status_idx" ON "notifications"("user_id", "read_status");

-- CreateIndex
CREATE INDEX "notifications_telegramSentAt_idx" ON "notifications"("telegramSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupKey_key" ON "notifications"("user_id", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_nonces" ADD CONSTRAINT "wallet_nonces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_parentChallengeId_fkey" FOREIGN KEY ("parentChallengeId") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_roles" ADD CONSTRAINT "challenge_roles_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_roles" ADD CONSTRAINT "challenge_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifier_id_fkey" FOREIGN KEY ("verifier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation" ADD CONSTRAINT "reputation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── GoalFi integrity guards (hand-written) ─────────────

-- Evidence content is immutable after submission. Only status / decidedAt may change.
CREATE OR REPLACE FUNCTION goalfi_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."links" IS DISTINCT FROM OLD."links"
     OR NEW."progressValue" IS DISTINCT FROM OLD."progressValue"
     OR NEW."activityDate" IS DISTINCT FROM OLD."activityDate"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."challenge_id" IS DISTINCT FROM OLD."challenge_id"
     OR NEW."participantId" IS DISTINCT FROM OLD."participantId"
     OR NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId" THEN
    RAISE EXCEPTION 'evidence content is immutable (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_immutable BEFORE UPDATE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION goalfi_evidence_immutable();

-- Evidence files are append-only.
CREATE OR REPLACE FUNCTION goalfi_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_files_append_only BEFORE UPDATE ON "evidence_files"
  FOR EACH ROW EXECUTE FUNCTION goalfi_append_only();

-- Verification decisions and audit logs can never be edited.
CREATE TRIGGER verifications_append_only BEFORE UPDATE ON "verifications"
  FOR EACH ROW EXECUTE FUNCTION goalfi_append_only();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION goalfi_append_only();

-- Basic value guards.
ALTER TABLE "challenges" ADD CONSTRAINT challenges_dates_chk CHECK ("end_date" > "start_date");
ALTER TABLE "challenges" ADD CONSTRAINT challenges_approvals_chk CHECK ("requiredApprovals" >= 1);
ALTER TABLE "markets" ADD CONSTRAINT markets_price_chk CHECK ("initial_price" = 0 OR ("initial_price" BETWEEN 100 AND 9900));
ALTER TABLE "transactions" ADD CONSTRAINT transactions_amount_chk CHECK ("amount" >= 0);
