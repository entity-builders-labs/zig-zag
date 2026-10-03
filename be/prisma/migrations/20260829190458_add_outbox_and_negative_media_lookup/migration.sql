-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'ENRICHED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "mediaError" TEXT,
ADD COLUMN     "mediaStatus" "MediaStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "mediaUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negative_media_lookup" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "lookupStrategy" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "negativeUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negative_media_lookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_event_status_nextAttemptAt_createdAt_idx" ON "outbox_event"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_event_status_leaseUntil_idx" ON "outbox_event"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "outbox_event_status_publishedAt_idx" ON "outbox_event"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "outbox_event_status_failedAt_idx" ON "outbox_event"("status", "failedAt");

-- CreateIndex
CREATE INDEX "negative_media_lookup_provider_lookupStrategy_lookupKey_neg_idx" ON "negative_media_lookup"("provider", "lookupStrategy", "lookupKey", "negativeUntil");

-- CreateIndex
CREATE UNIQUE INDEX "negative_media_lookup_provider_lookupStrategy_lookupKey_key" ON "negative_media_lookup"("provider", "lookupStrategy", "lookupKey");

-- RenameIndex
ALTER INDEX "activity_embedding_identity_idx" RENAME TO "activity_embeddingProvider_embeddingModel_embeddingDimensio_idx";
