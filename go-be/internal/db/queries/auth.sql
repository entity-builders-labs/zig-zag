-- Queries backing internal/auth, mirroring be/src/modules/auth/services/{auth,email-otp}.service.ts.

-- name: GetUserByProviderID :one
SELECT * FROM "user" WHERE "provider" = $1 AND "providerId" = $2;

-- name: GetUserByID :one
SELECT * FROM "user" WHERE "id" = $1;

-- name: CreateUser :one
INSERT INTO "user" ("id", "email", "name", "avatarUrl", "provider", "providerId", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5, $6, now(), now())
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE "user" SET "name" = $2, "avatarUrl" = $3, "updatedAt" = now()
WHERE "id" = $1
RETURNING *;

-- name: SetUserRefreshTokenHash :exec
UPDATE "user" SET "refreshTokenHash" = $2, "updatedAt" = now() WHERE "id" = $1;

-- name: ClearUserRefreshTokenHash :exec
UPDATE "user" SET "refreshTokenHash" = NULL, "updatedAt" = now() WHERE "id" = $1;

-- name: GetLastEmailLoginCode :one
SELECT * FROM "email_login_code" WHERE "email" = $1 ORDER BY "createdAt" DESC LIMIT 1;

-- name: GetPendingEmailLoginCode :one
SELECT * FROM "email_login_code" WHERE "email" = $1 AND "consumedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1;

-- name: CreateEmailLoginCode :one
INSERT INTO "email_login_code" ("id", "email", "codeHash", "expiresAt", "createdAt")
VALUES ($1, $2, $3, $4, now())
RETURNING *;

-- name: IncrementEmailLoginCodeAttempts :exec
UPDATE "email_login_code" SET "attempts" = "attempts" + 1 WHERE "id" = $1;

-- name: ConsumeEmailLoginCode :exec
UPDATE "email_login_code" SET "consumedAt" = now() WHERE "id" = $1;
