-- Typed canonical heritage scope on prominence evidence (prominence-v2,
-- task 39.8). Existing heritage rows were written before the scope was
-- normalized, so their scope is UNSPECIFIED until re-observed.

-- CreateEnum
CREATE TYPE "HeritageDesignationScope" AS ENUM ('INTERNATIONAL', 'NATIONAL', 'SUBNATIONAL', 'UNSPECIFIED');

-- AlterTable
ALTER TABLE "geo_entity_prominence_evidence" ADD COLUMN "heritageScope" "HeritageDesignationScope";

UPDATE "geo_entity_prominence_evidence" SET "heritageScope" = 'UNSPECIFIED' WHERE "kind" = 'HERITAGE_DESIGNATION';

-- A scope exists exactly on heritage designation facts.
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_heritage_scope_shape" CHECK (
  ("kind" = 'HERITAGE_DESIGNATION') = ("heritageScope" IS NOT NULL)
);
