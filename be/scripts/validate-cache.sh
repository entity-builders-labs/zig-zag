#!/bin/bash

# Script to validate cache is working in Docker
# Usage: ./scripts/validate-cache.sh

echo "🔍 Validating Cache in Docker..."
echo ""

# Get the container name
CONTAINER_NAME="zigzag-backend"

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
  echo "❌ Container $CONTAINER_NAME is not running"
  echo "   Start it with: docker-compose up -d backend"
  exit 1
fi

echo "✅ Container is running"
echo ""

# 1. Check cache directory exists
echo "📁 Checking cache directory..."
CACHE_DIR=$(docker exec $CONTAINER_NAME sh -c 'echo ${STORAGE_PATH:-/app/be/storage}/maps-cache')
echo "   Cache directory: $CACHE_DIR"

if docker exec $CONTAINER_NAME test -d "$CACHE_DIR"; then
  echo "   ✅ Cache directory exists"
else
  echo "   ⚠️  Cache directory does not exist (will be created on first use)"
fi

# 2. List cache files
echo ""
echo "📄 Cache files:"
CACHE_FILES=$(docker exec $CONTAINER_NAME sh -c "ls -1 $CACHE_DIR/*.json 2>/dev/null | wc -l" || echo "0")
if [ "$CACHE_FILES" -gt 0 ]; then
  echo "   Found $CACHE_FILES cache file(s):"
  docker exec $CONTAINER_NAME sh -c "ls -lh $CACHE_DIR/*.json 2>/dev/null | head -5" || echo "   (none)"
else
  echo "   ⚠️  No cache files found"
fi

# 3. Check environment variables
echo ""
echo "⚙️  Environment variables:"
USE_MOCK_MAPS=$(docker exec $CONTAINER_NAME sh -c 'echo $USE_MOCK_MAPS')
MOCK_MAPS_MODE=$(docker exec $CONTAINER_NAME sh -c 'echo $MOCK_MAPS_MODE')
STORAGE_PATH=$(docker exec $CONTAINER_NAME sh -c 'echo $STORAGE_PATH')

echo "   USE_MOCK_MAPS: ${USE_MOCK_MAPS:-not set}"
echo "   MOCK_MAPS_MODE: ${MOCK_MAPS_MODE:-not set (default: read)}"
echo "   STORAGE_PATH: ${STORAGE_PATH:-not set (default: /app/be/storage)}"

# 4. Check recent cache logs
echo ""
echo "📋 Recent cache logs (last 20 lines):"
docker logs $CONTAINER_NAME --tail 20 2>&1 | grep -i "cache" || echo "   No cache-related logs found"

echo ""
echo "💡 Tips:"
echo "   - Set MOCK_MAPS_MODE=write to populate cache"
echo "   - Set MOCK_MAPS_MODE=read to use cache (default)"
echo "   - Set MOCK_MAPS_MODE=strict to fail on cache miss"
echo "   - Watch logs: docker logs -f $CONTAINER_NAME | grep -i cache"
echo ""
echo "✅ Validation complete!"

