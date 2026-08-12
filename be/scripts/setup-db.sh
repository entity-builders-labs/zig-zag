#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required"
  exit 1
fi

export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"

echo "Generating Prisma Client..."
npx prisma generate

if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "Applying Prisma migrations..."
  npx prisma migrate deploy
elif [ "${NODE_ENV:-development}" = "production" ]; then
  echo "ERROR: production deployment requires committed Prisma migrations"
  exit 1
else
  echo "No migrations found; synchronizing the development database schema..."
  npx prisma db push
fi

echo "Database schema is ready"
