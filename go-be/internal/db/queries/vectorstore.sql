-- Queries backing internal/ai's VectorStore, mirroring
-- be/src/shared/ai/services/vector-store.service.ts.

-- name: UpdateActivityEmbedding :exec
UPDATE "activity" SET "embedding" = $2 WHERE "id" = $1;

-- name: ResetVectorStore :exec
-- Clears every stored embedding without touching Activity rows themselves.
UPDATE "activity" SET "embedding" = NULL;

-- name: CountEmbeddedActivities :one
SELECT count(*) FROM "activity" WHERE "embedding" IS NOT NULL;

-- name: FindSimilarActivitiesFull :many
SELECT "id", "name", "description", "type", "metadata",
       "embedding" <=> $1 AS distance
FROM "activity"
WHERE "embedding" IS NOT NULL
ORDER BY "embedding" <=> $1
LIMIT $2;

-- name: ListActivitiesWithMetadata :many
-- Feeds rebuildVectorStore: every activity that has enrichment metadata to embed from.
SELECT "id", "name", "description", "type", "metadata"
FROM "activity"
WHERE "metadata" IS NOT NULL;
