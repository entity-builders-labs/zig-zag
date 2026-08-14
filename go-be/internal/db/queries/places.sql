-- Queries backing internal/places, mirroring GooglePlacesService's Prisma
-- calls in be/src/modules/integrations/google-places/google-places.service.ts.

-- name: GetKnownActivityTypeByName :one
SELECT * FROM "known_activity_types" WHERE "name" = $1;

-- name: CreateKnownActivityType :one
INSERT INTO "known_activity_types" ("id", "name", "icon", "description", "category", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5, now(), now())
RETURNING *;

-- name: UpdateKnownActivityType :exec
UPDATE "known_activity_types" SET "icon" = $2, "description" = $3, "category" = $4, "updatedAt" = now()
WHERE "id" = $1;

-- name: GetSourceByName :one
SELECT * FROM "source" WHERE "name" = $1;

-- name: CreateSource :one
INSERT INTO "source" ("id", "name", "type", "baseUrl", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, now(), now())
RETURNING *;

-- name: GetActivityBySourceAndExternalID :one
SELECT "id" FROM "activity" WHERE "sourceId" = $1 AND "externalId" = $2;
