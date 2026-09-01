-- CreateEnum
CREATE TYPE "GeoEntityKind" AS ENUM ('PLACE', 'AREA', 'ROUTE');

-- CreateEnum
CREATE TYPE "ExperienceStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "geo_entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "GeoEntityKind" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geometry" JSONB,
    "address" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_entity_identity" (
    "id" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_entity_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER,
    "price" DOUBLE PRECISION,
    "status" "ExperienceStatus" NOT NULL DEFAULT 'PENDING',
    "qualityScore" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" JSONB,
    "mediaStatus" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "mediaUpdatedAt" TIMESTAMP(3),
    "mediaError" TEXT,
    "embedding" vector(256),
    "embeddingProvider" TEXT,
    "embeddingModel" TEXT,
    "embeddingDimensions" INTEGER,
    "embeddingDocumentVersion" INTEGER,
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_component" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "order" INTEGER,
    "role" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "experience_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_evidence" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "snippet" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trait_definition" (
    "id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trait_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_trait" (
    "experienceId" TEXT NOT NULL,
    "traitDefinitionId" TEXT NOT NULL,

    CONSTRAINT "experience_trait_pkey" PRIMARY KEY ("experienceId","traitDefinitionId")
);

-- CreateTable
CREATE TABLE "tour_experience" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 1,
    "startTime" TIMESTAMP(3),
    "duration" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_experience_component" (
    "id" TEXT NOT NULL,
    "tourExperienceId" TEXT NOT NULL,
    "geoEntityId" TEXT NOT NULL,
    "order" INTEGER,
    "role" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geometry" JSONB,

    CONSTRAINT "tour_experience_component_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_entity_kind_idx" ON "geo_entity"("kind");

-- CreateIndex
CREATE INDEX "geo_entity_latitude_longitude_idx" ON "geo_entity"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "geo_entity_identity_geoEntityId_idx" ON "geo_entity_identity"("geoEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entity_identity_provider_externalId_key" ON "geo_entity_identity"("provider", "externalId");

-- CreateIndex
CREATE INDEX "experience_status_idx" ON "experience"("status");

-- CreateIndex
CREATE INDEX "experience_latitude_longitude_idx" ON "experience"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "experience_embeddingProvider_embeddingModel_embeddingDimens_idx" ON "experience"("embeddingProvider", "embeddingModel", "embeddingDimensions", "embeddingDocumentVersion");

-- CreateIndex
CREATE INDEX "experience_component_geoEntityId_idx" ON "experience_component"("geoEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "experience_component_experienceId_geoEntityId_key" ON "experience_component"("experienceId", "geoEntityId");

-- CreateIndex
CREATE INDEX "experience_evidence_experienceId_idx" ON "experience_evidence"("experienceId");

-- CreateIndex
CREATE UNIQUE INDEX "trait_definition_dimension_key_key" ON "trait_definition"("dimension", "key");

-- CreateIndex
CREATE INDEX "experience_trait_traitDefinitionId_idx" ON "experience_trait"("traitDefinitionId");

-- CreateIndex
CREATE INDEX "tour_experience_tourId_idx" ON "tour_experience"("tourId");

-- CreateIndex
CREATE INDEX "tour_experience_experienceId_idx" ON "tour_experience"("experienceId");

-- CreateIndex
CREATE UNIQUE INDEX "tour_experience_tourId_experienceId_dayNumber_order_key" ON "tour_experience"("tourId", "experienceId", "dayNumber", "order");

-- CreateIndex
CREATE INDEX "tour_experience_component_tourExperienceId_idx" ON "tour_experience_component"("tourExperienceId");

-- AddForeignKey
ALTER TABLE "geo_entity_identity" ADD CONSTRAINT "geo_entity_identity_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_component" ADD CONSTRAINT "experience_component_geoEntityId_fkey" FOREIGN KEY ("geoEntityId") REFERENCES "geo_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_evidence" ADD CONSTRAINT "experience_evidence_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_trait" ADD CONSTRAINT "experience_trait_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_trait" ADD CONSTRAINT "experience_trait_traitDefinitionId_fkey" FOREIGN KEY ("traitDefinitionId") REFERENCES "trait_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_experience" ADD CONSTRAINT "tour_experience_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_experience" ADD CONSTRAINT "tour_experience_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "experience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_experience_component" ADD CONSTRAINT "tour_experience_component_tourExperienceId_fkey" FOREIGN KEY ("tourExperienceId") REFERENCES "tour_experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
