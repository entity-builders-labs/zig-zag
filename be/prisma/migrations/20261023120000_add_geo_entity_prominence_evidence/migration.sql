-- Structured prominence evidence as GeoEntity knowledge (design C14/C17,
-- task 39.3). No backfill: absence projects as UNKNOWN.

-- CreateEnum
CREATE TYPE "ProminenceEvidenceKind" AS ENUM ('ENCYCLOPEDIC_SITELINK_COUNT', 'ENCYCLOPEDIC_LANGUAGE_SITELINK', 'HERITAGE_DESIGNATION', 'EXPLICIT_VISITOR_CLASSIFICATION', 'PROVIDER_PROMINENCE');

-- CreateTable
CREATE TABLE "geo_entity_prominence_evidence" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "kind" "ProminenceEvidenceKind" NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "providerIdentity" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "numericValue" INTEGER,
    "textValue" TEXT,
    "languageCode" TEXT,
    "authority" TEXT,
    "designationLevel" TEXT,
    "providerMetric" TEXT,
    "comparisonScope" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "geo_entity_prominence_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_entity_prominence_evidence_geoEntityId_kind_idx" ON "geo_entity_prominence_evidence"("geoEntityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entity_prominence_evidence_geoEntityId_kind_sourceProvi_key" ON "geo_entity_prominence_evidence"("geoEntityId", "kind", "sourceProvider", "sourceRecordId", "fieldPath");

-- AddForeignKey
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (C14): per-kind shape keeps heterogeneous facts typed.
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_sitelink_shape" CHECK (
  "kind" NOT IN ('ENCYCLOPEDIC_SITELINK_COUNT', 'ENCYCLOPEDIC_LANGUAGE_SITELINK')
  OR ("numericValue" IS NOT NULL AND "numericValue" >= 0)
);
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_language_sitelink_shape" CHECK (
  "kind" <> 'ENCYCLOPEDIC_LANGUAGE_SITELINK' OR "languageCode" IS NOT NULL
);
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_heritage_shape" CHECK (
  "kind" <> 'HERITAGE_DESIGNATION' OR "designationLevel" IS NOT NULL
);
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_visitor_class_shape" CHECK (
  "kind" <> 'EXPLICIT_VISITOR_CLASSIFICATION' OR "textValue" IS NOT NULL
);
ALTER TABLE "geo_entity_prominence_evidence" ADD CONSTRAINT "geo_entity_prominence_evidence_provider_prominence_shape" CHECK (
  "kind" <> 'PROVIDER_PROMINENCE'
  OR ("providerMetric" IS NOT NULL AND "comparisonScope" IS NOT NULL AND ("numericValue" IS NOT NULL OR "textValue" IS NOT NULL))
);
