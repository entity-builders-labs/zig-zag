-- Target-level knowledge persistence (task 25.7, 2026-10-16).
--
-- geo_entity_target_observation stores one provider-fact observation about a
-- SemanticTarget (dimension + key) of a GeoEntity. Provider semantics
-- terminate at the adapter: only the normalized state
-- (SATISFIES / DOES_NOT_SATISFY / INCONCLUSIVE) and the stable source-fact
-- identity are stored. A re-observation upserts by sourceFactId, superseding
-- only the prior observation of that identity — never last-write-wins across
-- independent sources.

-- CreateEnum
CREATE TYPE "TargetObservationState" AS ENUM ('SATISFIES', 'DOES_NOT_SATISFY', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "geo_entity_target_observation" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" "TargetObservationState" NOT NULL,
    "sourceFactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_entity_target_observation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_entity_target_observation_geoEntityId_dimension_key_idx" ON "geo_entity_target_observation"("geoEntityId", "dimension", "key");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entity_target_observation_sourceFactId_key" ON "geo_entity_target_observation"("sourceFactId");

-- AddForeignKey
ALTER TABLE "geo_entity_target_observation" ADD CONSTRAINT "geo_entity_target_observation_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
