CREATE TABLE "overture_place_index" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "alternateNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "upstreamDataset" TEXT,
    "upstreamRecordId" TEXT,
    "upstreamUpdatedAt" TIMESTAMP(3),
    "license" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lapsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overture_place_index_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "overture_place_index_featureId_key" ON "overture_place_index"("featureId");
CREATE INDEX "overture_place_index_countryCode_normalizedName_idx" ON "overture_place_index"("countryCode", "normalizedName");
CREATE INDEX "overture_place_index_countryCode_partitionKey_idx" ON "overture_place_index"("countryCode", "partitionKey");

CREATE TABLE "overture_places_coverage" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "completeness" TEXT NOT NULL,
    "sourceUri" TEXT NOT NULL,
    "licenseNotice" TEXT,
    "synchronizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overture_places_coverage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "overture_places_coverage_countryCode_partitionKey_release_key" ON "overture_places_coverage"("countryCode", "partitionKey", "release");
CREATE INDEX "overture_places_coverage_countryCode_completeness_idx" ON "overture_places_coverage"("countryCode", "completeness");
