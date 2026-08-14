-- Queries backing internal/tours, mirroring ToursService/TourActivityGenerationService's
-- Prisma calls in be/src/modules/tours/services/*.ts.

-- name: CreateTour :one
INSERT INTO "tour" (
  "id", "ownerId", "name", "description", "price", "duration", "maxGroupSize",
  "startDates", "totalDays", "totalDistance", "estimatedBudget", "recommendedGroupSize",
  "prompt", "query", "categories", "metadata", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now()
) RETURNING *;

-- name: GetTour :one
SELECT * FROM "tour" WHERE "id" = $1;

-- name: GetTourOwnerID :one
SELECT "ownerId" FROM "tour" WHERE "id" = $1;

-- name: UpdateTourMetadata :exec
UPDATE "tour" SET "metadata" = $2, "updatedAt" = now() WHERE "id" = $1;

-- name: UpdateTourCoverImage :exec
UPDATE "tour" SET "coverImage" = $2, "updatedAt" = now() WHERE "id" = $1;

-- name: UpdateTour :one
UPDATE "tour" SET
  "name" = $2, "description" = $3, "price" = $4, "duration" = $5, "maxGroupSize" = $6,
  "startDates" = $7, "totalDays" = $8, "totalDistance" = $9, "estimatedBudget" = $10,
  "recommendedGroupSize" = $11, "prompt" = $12, "query" = $13, "categories" = $14,
  "metadata" = $15, "updatedAt" = now()
WHERE "id" = $1
RETURNING *;

-- name: DeleteTour :exec
-- TourActivity rows cascade-delete via the schema's onDelete: Cascade — no
-- separate tour_activity delete needed first (unlike Nest's explicit
-- deleteMany, which predates relying on the DB constraint).
DELETE FROM "tour" WHERE "id" = $1;

-- name: CountToursByOwner :one
SELECT count(*) FROM "tour" WHERE "ownerId" = $1 AND (sqlc.narg('category')::text IS NULL OR sqlc.narg('category')::text = ANY("categories"));

-- name: ListToursByOwner :many
SELECT * FROM "tour"
WHERE "ownerId" = $1 AND (sqlc.narg('category')::text IS NULL OR sqlc.narg('category')::text = ANY("categories"))
ORDER BY "createdAt" DESC
LIMIT $2 OFFSET $3;

-- name: ListToursNearCategory :many
-- Mirrors getNearbyTours' bounding-box + name/description ILIKE search.
SELECT DISTINCT t.* FROM "tour" t
LEFT JOIN "tour_activity" ta ON ta."tourId" = t."id"
LEFT JOIN "activity" a ON a."id" = ta."activityId"
WHERE (
  (ta."activityLatitude" BETWEEN $1 AND $2 AND ta."activityLongitude" BETWEEN $3 AND $4)
  OR (a."latitude" BETWEEN $1 AND $2 AND a."longitude" BETWEEN $3 AND $4)
) AND (t."name" ILIKE $5 OR t."description" ILIKE $5)
LIMIT 10;

-- name: CreateTourActivity :exec
INSERT INTO "tour_activity" (
  "id", "tourId", "activityId", "activityName", "activityType", "activityLatitude",
  "activityLongitude", "activityData", "duration", "startTime", "notes", "dayNumber",
  "travelTimeToNext", "distanceToNext", "order", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now()
);

-- name: DeleteTourActivities :exec
DELETE FROM "tour_activity" WHERE "tourId" = $1;

-- name: GetTourActivities :many
SELECT * FROM "tour_activity" WHERE "tourId" = $1 ORDER BY "order" ASC;

-- name: GetActivityLatLngByIDs :many
SELECT "id", "latitude", "longitude" FROM "activity" WHERE "id" = ANY(sqlc.arg('ids')::text[]);
