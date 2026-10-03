CREATE TABLE "overture_place_index" (
    "id" TEXT NOT NULL,
    "importSessionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overture_place_index_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "overture_place_index_importSessionId_featureId_key" ON "overture_place_index"("importSessionId", "featureId");
CREATE INDEX "overture_place_index_importSessionId_countryCode_normalizedName_idx" ON "overture_place_index"("importSessionId", "countryCode", "normalizedName");

CREATE TABLE "overture_places_import_session" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "completeness" TEXT NOT NULL,
    "expectedSourceCoverage" TEXT NOT NULL,
    "sourceUri" TEXT NOT NULL,
    "licenseNotice" TEXT,
    "expectedPageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "completedPageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "failedPartitionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "manifest" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overture_places_import_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "overture_places_import_session_countryCode_status_publishedAt_idx" ON "overture_places_import_session"("countryCode", "status", "publishedAt");
ALTER TABLE "overture_place_index" ADD CONSTRAINT "overture_place_index_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "overture_places_import_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
