-- Verified hint memory on GeoEntity (Stage 3, component-resolution plan).
--
-- Additive only: two text[] columns with empty defaults, one GIN index and
-- one CHECK. No existing row, canonical name, identity or metadata is
-- rewritten, and no alias is backfilled -- the memory fills only from new
-- VERIFIED resolutions.
--
-- "verifiedHintNames"    exact hint texts, verbatim, that previously
--                        resolved VERIFIED to this GeoEntity.
-- "verifiedHintNameKeys" normalizeGeoName() of each, positionally aligned
--                        and deduplicated by key (appended together, in one
--                        atomic UPDATE, by ExperienceCatalogService
--                        .rememberVerifiedHintName).
--
-- Not an alias engine and not globally unique: the same key may live on
-- several GeoEntities, and the catalog lookup keeps that multiplicity.

-- AlterTable
ALTER TABLE "geo_entity"
  ADD COLUMN "verifiedHintNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "verifiedHintNameKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Positional alignment of the two arrays (Prisma cannot declare CHECK
-- constraints; it does not diff them either, so this causes no drift).
ALTER TABLE "geo_entity"
  ADD CONSTRAINT "geo_entity_verified_hint_names_aligned"
  CHECK (cardinality("verifiedHintNames") = cardinality("verifiedHintNameKeys"));

-- CreateIndex
-- GIN (default array_ops) serves `"verifiedHintNameKeys" @> ARRAY[$key]`.
-- Declared in schema.prisma as @@index([verifiedHintNameKeys], type: Gin).
CREATE INDEX "geo_entity_verifiedHintNameKeys_idx" ON "geo_entity" USING GIN ("verifiedHintNameKeys");
