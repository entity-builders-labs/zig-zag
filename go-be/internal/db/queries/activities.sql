-- Queries backing internal/activities, mirroring ActivitiesService's Prisma
-- calls in be/src/modules/activities/services/activities.service.ts.

-- name: GetActivity :one
SELECT * FROM "activity" WHERE "id" = $1;

-- name: FindActivitiesInBoundingBox :many
SELECT * FROM "activity"
WHERE "latitude" >= $1 AND "latitude" <= $2 AND "longitude" >= $3 AND "longitude" <= $4;

-- name: GetActivityBySourceExternalID :one
SELECT * FROM "activity" WHERE "sourceId" = $1 AND "externalId" = $2;

-- name: CreateActivity :one
INSERT INTO "activity" (
  "id", "name", "description", "type", "difficulty", "duration", "price", "maxGroupSize",
  "latitude", "longitude", "location", "address", "sourceId", "externalId",
  "rating", "ratingCount", "formattedAddress", "phoneNumber", "website", "businessStatus",
  "priceLevel", "photos", "openingHours", "metadata", "knownActivityTypeName", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
  $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, now(), now()
) RETURNING *;

-- name: UpdateActivity :one
UPDATE "activity" SET
  "name" = $2, "description" = $3, "type" = $4, "difficulty" = $5, "duration" = $6,
  "price" = $7, "maxGroupSize" = $8, "latitude" = $9, "longitude" = $10, "location" = $11,
  "address" = $12, "sourceId" = $13, "externalId" = $14, "rating" = $15, "ratingCount" = $16,
  "formattedAddress" = $17, "phoneNumber" = $18, "website" = $19, "businessStatus" = $20,
  "priceLevel" = $21, "photos" = $22, "openingHours" = $23, "metadata" = $24,
  "knownActivityTypeName" = $25, "updatedAt" = now()
WHERE "id" = $1
RETURNING *;

-- name: DeleteActivity :one
DELETE FROM "activity" WHERE "id" = $1 RETURNING *;

-- name: GetActivitiesByIDs :many
SELECT * FROM "activity" WHERE "id" = ANY(sqlc.arg('ids')::text[]);

-- name: GetRecentCrawlerSearchNear :one
-- Mirrors HybridSearchService.shouldTriggerCrawling's findFirst — note this
-- table is read-only in the current Nest codebase (nothing ever writes a
-- CrawlerSearch row), so this lookup always misses and background crawling
-- triggers on every hybrid search. That looks like an incomplete feature
-- upstream, not something to silently "fix" here — ported as-is.
SELECT * FROM "crawler_search"
WHERE "latitude" >= $1 AND "latitude" <= $2 AND "longitude" >= $3 AND "longitude" <= $4
  AND "createdAt" >= $5
LIMIT 1;
