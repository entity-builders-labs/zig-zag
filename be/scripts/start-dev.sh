#!/bin/sh
set -e

echo '🚀 Starting backend application...'
echo "📊 Environment: ${NODE_ENV:-development}"

# Check if DATABASE_URL is set
if [ -n "$DATABASE_URL" ] && [ "$DATABASE_URL" != "" ]; then
  echo "📋 DATABASE_URL from env: SET"
else
  echo '📋 DATABASE_URL from env: NOT SET'
fi

# Detect if we're in development or production
# Development: NODE_ENV != "production" OR DATABASE_URL is not configured
# Production: NODE_ENV == "production" AND DATABASE_URL is configured (Supabase)
if [ "${NODE_ENV}" != "production" ] || [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" = "" ]; then
  echo '📦 Development mode: Using local PostgreSQL container...'
  echo '   ℹ️  Waiting for PostgreSQL Docker service (docker-compose --profile dev up postgres)...'
  
  # Check if we're running in Docker (service name 'postgres' is only available in Docker network)
  # In Docker Compose, services are accessible by their service name in the same network
  POSTGRES_HOST="postgres"
  
  # Wait for postgres Docker service to be available with retries (max 30 attempts = 60 seconds)
  # Using nc (netcat) to check if the postgres service port is open
  # This verifies that the Docker service is running and accessible
  MAX_RETRIES=30
  RETRY_COUNT=0
  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Check if postgres Docker service is accessible on port 5432
    # nc -z: scan for listening daemons without sending any data
    # This works in Docker networks where service names resolve to container IPs
    if nc -z "$POSTGRES_HOST" 5432 2>/dev/null; then
      echo "   ✅ PostgreSQL Docker service is running and accessible at $POSTGRES_HOST:5432"
      export DATABASE_URL="postgresql://postgres:postgres@$POSTGRES_HOST:5432/zigzag"
      export DIRECT_URL="postgresql://postgres:postgres@$POSTGRES_HOST:5432/zigzag"
      echo "   DATABASE_URL: postgresql://postgres:***@$POSTGRES_HOST:5432/zigzag"
      break
    else
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "   ⏳ Waiting for PostgreSQL Docker service at $POSTGRES_HOST:5432... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
      else
        echo "   ⚠️  PostgreSQL Docker service is not available after $MAX_RETRIES attempts"
        echo "   💡 Make sure the postgres service is running:"
        echo "      docker-compose --profile dev up postgres"
        echo "   💡 Or configure DATABASE_URL in your .env to use Supabase"
        echo "      Example: DATABASE_URL=postgresql://user:pass@host:6543/db"
        exit 1
      fi
    fi
  done
else
  echo '☁️  Production mode: Using provided DATABASE_URL (Supabase)...'
  # For Supabase: Direct connection (5432) is NOT IPv4 compatible
  # Use Session Pooler (6543) for IPv4 networks (like Docker)
  # The setup script will handle DIRECT_URL configuration
  if [ -z "$DIRECT_URL" ]; then
    echo '📝 DIRECT_URL not set - setup script will configure it'
    echo '   💡 For Supabase: Use Session Pooler (port 6543) for IPv4 compatibility'
  else
    echo '✅ DIRECT_URL provided'
  fi
  echo "   DATABASE_URL: ${DATABASE_URL%%@*}@..."
fi

# Remove .env files from be directory to prevent Prisma from reading them
rm -f /app/be/.env /app/.env 2>/dev/null || true
echo "Using DATABASE_URL: $DATABASE_URL"

cd /app/be

# Run database setup script
# Usar set +e temporalmente para que el setup no detenga el contenedor si falla
set +e
if [ -f "scripts/setup-db.sh" ]; then
  echo "📋 Ejecutando setup-db.sh..."
  sh scripts/setup-db.sh
  SETUP_EXIT_CODE=$?
  if [ $SETUP_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "⚠️  Database setup falló con código $SETUP_EXIT_CODE"
    echo "   El contenedor continuará, pero la aplicación puede no funcionar correctamente"
    echo "   Revisa los logs anteriores para más detalles"
    echo ""
    echo "💡 Si db push se quedó colgado, intenta:"
    echo "   1. Crear migraciones en su lugar: npx prisma migrate dev --name init"
    echo "   2. O verificar que PostgreSQL esté accesible"
    echo ""
  fi
else
  echo '⚠️  Setup script not found, running manual setup...'
  npx prisma generate
  if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    echo '📋 Migrations found, applying...'
    npx prisma migrate deploy || echo "⚠️  Migrate deploy failed, continuing anyway..."
  else
    echo '⚠️  No migrations found, using db push (development only)...'
    npx prisma db push --accept-data-loss || echo "⚠️  db push failed, continuing anyway..."
  fi
fi
set -e  # Reactivar set -e

echo '🚀 Starting application...'
yarn start:dev

