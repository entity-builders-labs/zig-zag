# Cache Validation Guide (Docker)

This guide explains how to validate that the cache system is working correctly in Docker.

## Where is the cache stored?

**The cache is stored inside the Docker container, but it persists on your local machine.**

This works thanks to the volume mounts in `docker-compose.yml`:

```yaml
volumes:
  - ./be:/app/be # Mounts ./be from host into /app/be in container
```

**What does this mean?**

- **Inside the container**: Cache is stored at `/app/be/storage/maps-cache`
- **On your machine**: Files are stored at `./be/storage/maps-cache` (relative to project root)
- **Benefit**: If you delete the container, cache files **remain** on your machine

**Important**: The `STORAGE_PATH` directory must be writable both in the container and on your local machine.

## Quick Validation

Run the validation script:

```bash
./be/scripts/validate-cache.sh
```

Or from the project root:

```bash
docker exec zigzag-backend sh /app/be/scripts/validate-cache.sh
```

## Manual Validation Steps

### 1. Check Environment Variables

Verify cache is enabled:

```bash
docker exec zigzag-backend sh -c 'echo "USE_MOCK_MAPS: $USE_MOCK_MAPS"'
docker exec zigzag-backend sh -c 'echo "MOCK_MAPS_MODE: $MOCK_MAPS_MODE"'
docker exec zigzag-backend sh -c 'echo "STORAGE_PATH: $STORAGE_PATH"'
```

**Expected values:**

- `USE_MOCK_MAPS=true` (enables caching)
- `MOCK_MAPS_MODE=read` or `write` or `strict`
- `STORAGE_PATH` (optional, defaults to `/app/be/storage`)

### 2. Check Cache Directory

```bash
# Find cache directory
docker exec zigzag-backend sh -c 'echo ${STORAGE_PATH:-/app/be/storage}/maps-cache'

# List cache files
docker exec zigzag-backend sh -c 'ls -lh ${STORAGE_PATH:-/app/be/storage}/maps-cache/*.json 2>/dev/null | head -10'

# Count cache files
docker exec zigzag-backend sh -c 'ls -1 ${STORAGE_PATH:-/app/be/storage}/maps-cache/*.json 2>/dev/null | wc -l'
```

### 3. Monitor Cache Logs

Watch for cache hits/misses in real-time:

```bash
# Watch all logs
docker logs -f zigzag-backend

# Filter only cache-related logs
docker logs -f zigzag-backend 2>&1 | grep -i "cache"

# Filter cache hits
docker logs -f zigzag-backend 2>&1 | grep "Cache hit"

# Filter cache misses
docker logs -f zigzag-backend 2>&1 | grep "Cache miss"
```

### 4. Test Cache Behavior

#### Step 1: Populate Cache (Write Mode)

```bash
# Set write mode in .env or docker-compose.yml
# MOCK_MAPS_MODE=write

# Restart container
docker-compose restart backend

# Make a request that uses the selected PLACES_PROVIDER
# (e.g., search for activities, create a tour, etc.)

# Check if cache file was created
docker exec zigzag-backend sh -c 'ls -lh ${STORAGE_PATH:-/app/be/storage}/maps-cache/*.json | tail -5'
```

#### Step 2: Test Cache Hit (Read Mode)

```bash
# Set read mode
# MOCK_MAPS_MODE=read

# Restart container
docker-compose restart backend

# Make the SAME request again (same parameters)
# You should see "Cache hit" in logs

# Check logs
docker logs zigzag-backend --tail 50 | grep -i "cache"
```

#### Step 3: Test Cache Miss

```bash
# Make a request with DIFFERENT parameters
# You should see "Cache miss" in logs

# Check logs
docker logs zigzag-backend --tail 50 | grep -i "cache"
```

### 5. Inspect Cache Files

```bash
# View a cache file
docker exec zigzag-backend sh -c 'cat ${STORAGE_PATH:-/app/be/storage}/maps-cache/*-v2-searchNearby-*.json | head -1 | jq .' 2>/dev/null

# List all cache keys
docker exec zigzag-backend sh -c 'ls -1 ${STORAGE_PATH:-/app/be/storage}/maps-cache/*.json | xargs -n1 basename'
```

### 6. Test Strict Mode

```bash
# Set strict mode
# MOCK_MAPS_MODE=strict

# Restart container
docker-compose restart backend

# Make a request with parameters NOT in cache
# Should throw an error (no API calls allowed)
```

## Expected Log Messages

### Cache Hit

```
[CachedPlacesApiService] Cache hit for searchNearby (google-v2-searchNearby-abc123.json)
```

### Cache Miss (Read Mode)

```
[CachedPlacesApiService] Cache miss for searchNearby (google-v2-searchNearby-abc123.json). Calling real API...
```

### Cache Miss (Write Mode)

```
[CachedPlacesApiService] Cache miss for searchNearby (google-v2-searchNearby-abc123.json). Calling real API...
[CachedPlacesApiService] Cached response for searchNearby (google-v2-searchNearby-abc123.json)
```

### Cache Miss (Strict Mode)

```
Error: [CachedPlacesApiService] Strict mode: cache miss for google.searchNearby (google-v2-searchNearby-abc123.json); live API calls are disabled.
```

## Troubleshooting

### Cache files not persisting

Check volume mounts in `docker-compose.yml`:

```yaml
volumes:
  - ./be:/app/be # This should include storage directory
```

**Why this matters**: Without this volume mount, cache files would only exist inside the container and be lost when the container is removed.

### Cache directory not found

The directory is created automatically on first use. If it doesn't exist:

```bash
docker exec zigzag-backend mkdir -p ${STORAGE_PATH:-/app/be/storage}/maps-cache
```

### Cache not working

1. Verify `USE_MOCK_MAPS=true` is set
2. Check logs for errors
3. Verify `STORAGE_PATH` is writable (both in container and on host machine)
4. Check file permissions in container

## Cache File Naming

Cache files are named using MD5 hash of parameters:

- Format: `{method}-{hash}.json`
- Example: `searchNearby-258ede222ab97a4c8d9672dd921d3b1d.json`

Same parameters = same hash = same cache file = cache hit!
