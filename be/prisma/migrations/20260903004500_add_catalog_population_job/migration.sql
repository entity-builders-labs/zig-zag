CREATE TABLE "catalog_population_job" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "scope" JSONB NOT NULL,
  "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "intents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "beforeCount" INTEGER NOT NULL DEFAULT 0,
  "afterCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "reusedCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "trace" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_population_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_population_job_idempotencyKey_key"
  ON "catalog_population_job"("idempotencyKey");
CREATE INDEX "catalog_population_job_status_createdAt_idx"
  ON "catalog_population_job"("status", "createdAt");
CREATE INDEX "catalog_population_job_requestedById_idx"
  ON "catalog_population_job"("requestedById");
