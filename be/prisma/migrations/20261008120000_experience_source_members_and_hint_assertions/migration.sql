-- Partial composite persistence + verified-hint provenance (2026-10-08).
--
-- 1. experience_component becomes ONE ROW PER SOURCE-DECLARED MEMBER of an
--    Experience composition, resolved or not. Two source members may
--    resolve to the same GeoEntity, so (experienceId, geoEntityId) no longer
--    identifies a member: identity is (experienceId, sourcePosition).
--    Legacy rows keep sourcePosition / sourceName / resolutionSource NULL:
--    their source position and source wording were never recorded and are
--    NOT fabricated here (no backfill from GeoEntity.name). They default to
--    RESOLVED, which is what every legacy row was.
-- 2. geo_entity_verified_hint_assertion records who asserted each verified
--    hint and keeps revoked assertions as audit history. The existing
--    geo_entity.verifiedHintNames / verifiedHintNameKeys arrays stay the
--    fast lookup index. Every key present in them today was written by the
--    automatic resolver (the only writer), so it is backfilled as one
--    AUTOMATIC assertion; createdAt is the migration time, because the
--    original write time was never recorded.

-- CreateEnum
CREATE TYPE "ExperienceComponentResolutionState" AS ENUM ('RESOLVED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "ExperienceComponentResolutionReason" AS ENUM ('NO_CANDIDATE_ACQUIRED', 'CANDIDATE_UNCONFIRMED', 'CANDIDATE_REJECTED', 'AMBIGUOUS_CANDIDATES', 'RESOLUTION_REVOKED');

-- CreateEnum
CREATE TYPE "CatalogKnowledgeSource" AS ENUM ('AUTOMATIC', 'ADMIN');

-- DropIndex
DROP INDEX "experience_component_experienceId_geoEntityId_key";

-- AlterTable
ALTER TABLE "experience_component" ADD COLUMN     "resolutionReason" "ExperienceComponentResolutionReason",
ADD COLUMN     "resolutionSource" "CatalogKnowledgeSource",
ADD COLUMN     "resolutionState" "ExperienceComponentResolutionState" NOT NULL DEFAULT 'RESOLVED',
ADD COLUMN     "sourceName" TEXT,
ADD COLUMN     "sourcePosition" INTEGER,
ALTER COLUMN "geoEntityId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "geo_entity_verified_hint_assertion" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "hintName" TEXT NOT NULL,
    "hintKey" TEXT NOT NULL,
    "source" "CatalogKnowledgeSource" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "geo_entity_verified_hint_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_entity_verified_hint_assertion_hintKey_idx" ON "geo_entity_verified_hint_assertion"("hintKey");

-- CreateIndex
CREATE INDEX "geo_entity_verified_hint_assertion_geoEntityId_hintKey_idx" ON "geo_entity_verified_hint_assertion"("geoEntityId", "hintKey");

-- CreateIndex
CREATE INDEX "experience_component_experienceId_resolutionState_idx" ON "experience_component"("experienceId", "resolutionState");

-- CreateIndex
CREATE UNIQUE INDEX "experience_component_experienceId_sourcePosition_key" ON "experience_component"("experienceId", "sourcePosition");

-- AddForeignKey
ALTER TABLE "geo_entity_verified_hint_assertion" ADD CONSTRAINT "geo_entity_verified_hint_assertion_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_entity_verified_hint_assertion" ADD CONSTRAINT "geo_entity_verified_hint_assertion_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_entity_verified_hint_assertion" ADD CONSTRAINT "geo_entity_verified_hint_assertion_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Member resolution consistency (Prisma cannot declare CHECK constraints and
-- does not diff them, so this causes no drift).
ALTER TABLE "experience_component"
  ADD CONSTRAINT "experience_component_resolution_consistent"
  CHECK (
    (
      "resolutionState" = 'RESOLVED'
      AND "geoEntityId" IS NOT NULL
      AND "resolutionReason" IS NULL
    )
    OR (
      "resolutionState" = 'UNRESOLVED'
      AND "geoEntityId" IS NULL
      AND "resolutionSource" IS NULL
      AND "resolutionReason" IS NOT NULL
      AND "sourceName" IS NOT NULL
      AND "sourcePosition" IS NOT NULL
    )
  );

ALTER TABLE "experience_component"
  ADD CONSTRAINT "experience_component_source_position_non_negative"
  CHECK ("sourcePosition" IS NULL OR "sourcePosition" >= 0);

ALTER TABLE "geo_entity_verified_hint_assertion"
  ADD CONSTRAINT "geo_entity_verified_hint_assertion_key_present"
  CHECK (length("hintKey") > 0);

-- At most one ACTIVE assertion per (GeoEntity, key, source). Revoked rows
-- are history and never collide.
CREATE UNIQUE INDEX "geo_entity_verified_hint_assertion_active_key"
  ON "geo_entity_verified_hint_assertion" ("geoEntityId", "hintKey", "source")
  WHERE "revokedAt" IS NULL;

-- Backfill: one AUTOMATIC assertion per key already in the fast index.
INSERT INTO "geo_entity_verified_hint_assertion"
  ("id", "geoEntityId", "hintName", "hintKey", "source")
SELECT gen_random_uuid()::text, g."id", hint.name, hint.key, 'AUTOMATIC'
FROM "geo_entity" g
CROSS JOIN LATERAL unnest(g."verifiedHintNames", g."verifiedHintNameKeys")
  AS hint(name, key)
WHERE length(hint.key) > 0;
