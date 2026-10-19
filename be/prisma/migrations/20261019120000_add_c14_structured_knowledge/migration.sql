-- CreateEnum
CREATE TYPE "AdmissionOutcome" AS ENUM ('ADMITTED', 'EXCLUDED_CATEGORY', 'INSUFFICIENT_ADMISSION_EVIDENCE');

-- CreateEnum
CREATE TYPE "AdmissionSignal" AS ENUM ('EXPLICIT_VISITOR_CLASSIFICATION', 'HISTORIC_CLASSIFICATION', 'HERITAGE_DESIGNATION', 'VISITABLE_PLACE_CLASS', 'ENCYCLOPEDIC_NOTABILITY', 'PROVIDER_PROMINENCE');

-- CreateEnum
CREATE TYPE "AdmissionExclusion" AS ENUM ('ADMINISTRATIVE_OR_LOCALITY', 'ROAD_OR_ROUTE_AS_PLACE', 'INFORMATION_OR_SIGNAGE', 'TRANSPORT_SERVICE', 'TECHNICAL_INFRASTRUCTURE', 'ACCOMMODATION');

-- CreateEnum
CREATE TYPE "GeoEntityRelationType" AS ENUM ('PART_OF');

-- CreateEnum
CREATE TYPE "RelationEvidenceSource" AS ENUM ('PROVIDER_SITE_MEMBERSHIP', 'ENCYCLOPEDIC_PART_OF', 'DECLARED_CONTAINMENT');

-- CreateEnum
CREATE TYPE "VisitUnitClassification" AS ENUM ('CHILD_REQUIRES_PARENT_VISIT', 'CHILD_INDEPENDENTLY_VISITABLE', 'AMBIGUOUS_PARENT_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "OpeningHoursStatus" AS ENUM ('KNOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VisitDurationStatus" AS ENUM ('RESOLVED', 'CONFLICTING', 'INSUFFICIENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "DurationAuthorityClass" AS ENUM ('STRUCTURED_PROVIDER', 'OFFICIAL_SITE', 'OFFICIAL_TOURISM_OR_INSTITUTIONAL', 'REFERENCE_TRAVEL', 'USER_GENERATED', 'GROUNDED_SYNTHESIS');

-- CreateEnum
CREATE TYPE "ExperienceComponentParticipation" AS ENUM ('VISIT', 'TRAVERSE');

-- CreateEnum
CREATE TYPE "IdentityLinkRule" AS ENUM ('FIRST_IDENTITY', 'SAME_PROVIDER_ID', 'SHARED_ENCYCLOPEDIC_ID', 'PROVIDER_STRUCTURAL_RELATION', 'PROVIDER_CROSS_LINK', 'STRUCTURAL_CORRESPONDENCE');

-- CreateEnum
CREATE TYPE "TourReadinessVerdict" AS ENUM ('READY', 'PLANNER_LIMITED');

-- AlterTable
ALTER TABLE "experience" ADD COLUMN "compositionSignature" TEXT;

-- AlterTable
ALTER TABLE "experience_component" ADD COLUMN "participation" "ExperienceComponentParticipation",
ADD COLUMN "traversalDirected" BOOLEAN,
ADD COLUMN "traversalFromGeoEntityId" TEXT,
ADD COLUMN "traversalFromLatitude" DOUBLE PRECISION,
ADD COLUMN "traversalFromLongitude" DOUBLE PRECISION,
ADD COLUMN "traversalGeometry" JSONB,
ADD COLUMN "traversalGeometrySource" TEXT,
ADD COLUMN "traversalResolvedAt" TIMESTAMP(3),
ADD COLUMN "traversalToGeoEntityId" TEXT,
ADD COLUMN "traversalToLatitude" DOUBLE PRECISION,
ADD COLUMN "traversalToLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "geo_entity_identity" ADD COLUMN "linkEvidence" JSONB,
ADD COLUMN "linkPolicyVersion" TEXT,
ADD COLUMN "linkRule" "IdentityLinkRule";

-- AlterTable
ALTER TABLE "tour" ADD COLUMN "planningContext" JSONB,
ADD COLUMN "planningDiagnostics" JSONB,
ADD COLUMN "readinessVerdict" "TourReadinessVerdict",
ADD COLUMN "timezone" TEXT;

-- AlterTable
ALTER TABLE "tour_experience" ADD COLUMN "endTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tour_experience_component" ADD COLUMN "participation" "ExperienceComponentParticipation",
ADD COLUMN "plannedEnd" TIMESTAMP(3),
ADD COLUMN "plannedStart" TIMESTAMP(3),
ADD COLUMN "planningEvidence" JSONB;

-- CreateTable
CREATE TABLE "geo_entity_admission" (
    "geoEntityId" TEXT NOT NULL,
    "outcome" "AdmissionOutcome" NOT NULL,
    "rule" TEXT NOT NULL,
    "signals" "AdmissionSignal"[] DEFAULT ARRAY[]::"AdmissionSignal"[],
    "exclusions" "AdmissionExclusion"[] DEFAULT ARRAY[]::"AdmissionExclusion"[],
    "policyVersion" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "geo_entity_admission_pkey" PRIMARY KEY ("geoEntityId")
);

-- CreateTable
CREATE TABLE "geo_entity_relation" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "type" "GeoEntityRelationType" NOT NULL,
    "evidenceSource" "RelationEvidenceSource" NOT NULL,
    "evidence" JSONB NOT NULL,
    "visitUnitClassification" "VisitUnitClassification",
    "classificationVersion" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "geo_entity_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_entity_opening_hours" (
    "geoEntityId" TEXT NOT NULL,
    "status" "OpeningHoursStatus" NOT NULL,
    "timezone" TEXT,
    "schedule" JSONB,
    "scheduleVersion" INTEGER,
    "source" TEXT NOT NULL,
    "sourceRecordRef" TEXT,
    "sourceRaw" TEXT,
    "parserVersion" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "geo_entity_opening_hours_pkey" PRIMARY KEY ("geoEntityId")
);

-- CreateTable
CREATE TABLE "geo_entity_visit_duration" (
    "geoEntityId" TEXT NOT NULL,
    "status" "VisitDurationStatus" NOT NULL,
    "minMinutes" INTEGER,
    "typicalMinutes" INTEGER,
    "maxMinutes" INTEGER,
    "authorityClass" "DurationAuthorityClass",
    "evidenceQuality" TEXT,
    "evidence" JSONB NOT NULL,
    "resolverVersion" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "geo_entity_visit_duration_pkey" PRIMARY KEY ("geoEntityId")
);

-- CreateIndex
CREATE INDEX "geo_entity_admission_outcome_policyVersion_idx" ON "geo_entity_admission"("outcome", "policyVersion");
CREATE INDEX "geo_entity_relation_parentId_type_idx" ON "geo_entity_relation"("parentId", "type");
CREATE INDEX "geo_entity_relation_childId_visitUnitClassification_idx" ON "geo_entity_relation"("childId", "visitUnitClassification");
CREATE UNIQUE INDEX "geo_entity_relation_childId_parentId_type_key" ON "geo_entity_relation"("childId", "parentId", "type");
CREATE INDEX "geo_entity_opening_hours_retrievedAt_idx" ON "geo_entity_opening_hours"("retrievedAt");
CREATE INDEX "geo_entity_visit_duration_status_resolvedAt_idx" ON "geo_entity_visit_duration"("status", "resolvedAt");
CREATE UNIQUE INDEX "experience_compositionSignature_key" ON "experience"("compositionSignature");

-- AddForeignKey
ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_traversalFromGeoEntityId_fkey" FOREIGN KEY ("traversalFromGeoEntityId") REFERENCES "geo_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_traversalToGeoEntityId_fkey" FOREIGN KEY ("traversalToGeoEntityId") REFERENCES "geo_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geo_entity_admission" ADD CONSTRAINT "geo_entity_admission_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "geo_entity_relation" ADD CONSTRAINT "geo_entity_relation_childId_fkey" FOREIGN KEY ("childId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "geo_entity_relation" ADD CONSTRAINT "geo_entity_relation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "geo_entity_opening_hours" ADD CONSTRAINT "geo_entity_opening_hours_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "geo_entity_visit_duration" ADD CONSTRAINT "geo_entity_visit_duration_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (C14): decision-bearing invariants enforced at the DB.
ALTER TABLE "geo_entity_relation" ADD CONSTRAINT "geo_entity_relation_no_self_reference" CHECK ("childId" <> "parentId");
ALTER TABLE "geo_entity_relation" ADD CONSTRAINT "geo_entity_relation_classification_consistent" CHECK (("visitUnitClassification" IS NULL) = ("classificationVersion" IS NULL));

ALTER TABLE "geo_entity_opening_hours" ADD CONSTRAINT "geo_entity_opening_hours_known_consistent" CHECK ("status" <> 'KNOWN' OR ("schedule" IS NOT NULL AND "scheduleVersion" IS NOT NULL AND "timezone" IS NOT NULL));

ALTER TABLE "geo_entity_visit_duration" ADD CONSTRAINT "geo_entity_visit_duration_range_ordered" CHECK (
    ("minMinutes" IS NULL OR "typicalMinutes" IS NULL OR "minMinutes" <= "typicalMinutes")
    AND ("typicalMinutes" IS NULL OR "maxMinutes" IS NULL OR "typicalMinutes" <= "maxMinutes")
);
ALTER TABLE "geo_entity_visit_duration" ADD CONSTRAINT "geo_entity_visit_duration_resolved_consistent" CHECK (
    "status" <> 'RESOLVED'
    OR "typicalMinutes" IS NOT NULL
    OR ("minMinutes" IS NOT NULL AND "maxMinutes" IS NOT NULL)
);
ALTER TABLE "geo_entity_visit_duration" ADD CONSTRAINT "geo_entity_visit_duration_insufficient_consistent" CHECK (
    "status" <> 'INSUFFICIENT_EVIDENCE'
    OR ("minMinutes" IS NULL AND "typicalMinutes" IS NULL AND "maxMinutes" IS NULL)
);

ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_traversal_participation" CHECK (
    ("traversalFromGeoEntityId" IS NULL AND "traversalToGeoEntityId" IS NULL AND "traversalFromLatitude" IS NULL AND "traversalFromLongitude" IS NULL AND "traversalToLatitude" IS NULL AND "traversalToLongitude" IS NULL AND "traversalGeometry" IS NULL AND "traversalGeometrySource" IS NULL AND "traversalDirected" IS NULL AND "traversalResolvedAt" IS NULL)
    OR "participation" = 'TRAVERSE'
);
ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_traversal_bounds_consistent" CHECK (
    ("traversalFromLatitude" IS NULL) = ("traversalFromLongitude" IS NULL)
    AND ("traversalToLatitude" IS NULL) = ("traversalToLongitude" IS NULL)
    AND ("traversalGeometry" IS NULL) = ("traversalGeometrySource" IS NULL)
);
