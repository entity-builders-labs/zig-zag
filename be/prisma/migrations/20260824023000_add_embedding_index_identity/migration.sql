-- Existing vectors predate enforceable provider/model/document identity.
-- They cannot safely participate in similarity search after this migration;
-- an operator must run the explicit full rebuild command for the configured
-- provider before semantic ranking becomes available again.
ALTER TABLE "activity"
  ADD COLUMN "embeddingProvider" TEXT,
  ADD COLUMN "embeddingModel" TEXT,
  ADD COLUMN "embeddingDimensions" INTEGER,
  ADD COLUMN "embeddingDocumentVersion" INTEGER,
  ADD COLUMN "embeddedAt" TIMESTAMP(3);

UPDATE "activity" SET "embedding" = NULL;

CREATE INDEX "activity_embedding_identity_idx"
  ON "activity"(
    "embeddingProvider",
    "embeddingModel",
    "embeddingDimensions",
    "embeddingDocumentVersion"
  );
