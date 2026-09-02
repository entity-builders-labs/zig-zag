CREATE TABLE IF NOT EXISTS "experience_media" (
  "id" TEXT NOT NULL,
  "experienceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "caption" TEXT,
  "author" TEXT,
  "authorUrl" TEXT,
  "license" TEXT,
  "licenseUrl" TEXT,
  "sourceUrl" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "experience_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_media_experienceId_fkey"
    FOREIGN KEY ("experienceId") REFERENCES "experience"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "experience_media_experienceId_url_key"
  ON "experience_media"("experienceId", "url");
CREATE INDEX IF NOT EXISTS "experience_media_experienceId_position_idx"
  ON "experience_media"("experienceId", "position");
CREATE INDEX IF NOT EXISTS "experience_media_provider_idx"
  ON "experience_media"("provider");
