-- Foundation-phase queries: exist to validate sqlc's type mapping for JSON,
-- native array, and pgvector columns against the real schema before any
-- domain module builds its full query set on top of it.

-- name: GetActivityByID :one
SELECT "id", "name", "metadata", "photos", "embedding"
FROM "activity"
WHERE "id" = $1;

-- name: GetTourByID :one
SELECT "id", "name", "startDates", "categories", "metadata"
FROM "tour"
WHERE "id" = $1;

-- name: FindSimilarActivities :many
-- Mirrors VectorStoreService.findSimilarActivities (be/src/shared/ai/services/vector-store.service.ts):
-- cosine distance via the <=> operator, ordered nearest-first.
SELECT "id", "name", "embedding" <=> $1 AS distance
FROM "activity"
WHERE "embedding" IS NOT NULL
ORDER BY "embedding" <=> $1
LIMIT $2;
