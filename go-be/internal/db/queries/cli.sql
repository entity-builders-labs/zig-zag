-- Queries backing cmd/cli's maintenance commands, mirroring the Prisma
-- calls in be/src/commands/scripts/commands/*.command.ts.

-- name: ListActivitiesWithID :many
SELECT "id", "name", "metadata" FROM "activity";

-- name: ListToursWithoutCoverImage :many
SELECT "id", "name" FROM "tour" WHERE "coverImage" IS NULL OR "coverImage" = '';

-- name: ListActivitiesWithoutPhotos :many
SELECT "id", "name", "type", "description" FROM "activity"
WHERE "photos" IS NULL OR "photos"::text = 'null' OR "photos"::text = '[]';

-- name: SetActivityPhotos :exec
UPDATE "activity" SET "photos" = $2, "updatedAt" = now() WHERE "id" = $1;
