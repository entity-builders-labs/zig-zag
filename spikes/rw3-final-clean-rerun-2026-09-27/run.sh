#!/usr/bin/env bash
# RW3 anchor-handoff rerun: Caminito canonical ROUTE after commit d6149363
# (same-branch destination screening, audit-free source-plan fingerprints,
# typed anchorNames handed to the discovery extractor). Real HTTP product path
# (auth -> generate-tour -> outbox -> processor -> generation) on a dedicated
# spike DB, fresh backend whose outbound requests are counted by
# count-requests.cjs.
#
#   run.sh <label> <db> fresh|reuse <port>
# fresh = drop/create/migrate the DB (COLD); reuse = same DB (WARM).
#
# Canonical provider pair, pinned (no SerpAPI, no Tavily, no fallback):
# GROUNDED_SEARCH_PROVIDER=serper, DISCOVERY_EXTRACTOR_PROVIDER=cloudflare
# (@cf/qwen/qwen3.8-27b, 60s timeout), PLACES_PROVIDER=geoapify.
# Classification = the repo .env's configured CLASSIFICATION_PROVIDER,
# unchanged and recorded. provider-preflight.cjs resolves the compiled
# runtime selection with this exact env and ABORTS before any live call if it
# is not the canonical pair. Credentials come from the gitignored repo-root
# .env at run time; nothing secret is written here.
set -euo pipefail
LABEL="$1"; DB="$2"; MODE="$3"; PORT="$4"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ORCH="$HERE/run-campaign.mjs"
OUT="$HERE/$LABEL"
mkdir -p "$OUT"
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<ENV
GROUNDED_SEARCH_PROVIDER=serper
DISCOVERY_EXTRACTOR_PROVIDER=cloudflare
CLOUDFLARE_DISCOVERY_MODEL=@cf/qwen/qwen3.8-27b
CLOUDFLARE_DISCOVERY_TIMEOUT_MS=60000
PLACES_PROVIDER=geoapify
OVERPASS_API_URL=http://localhost:12345/api/interpreter
NOMINATIM_API_URL=http://localhost:8088/search
NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/$DB
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/$DB
USE_MOCK_MAPS=false
MOCK_MAPS_MODE=strict
AI_CACHE_MODE=off
PORT=$PORT
ENV
# Provider preflight BEFORE touching the DB or spending any live call.
(
  cd "$REPO/be"
  set -a; source "$REPO/.env"; source "$ENV_FILE"; set +a
  node "$HERE/provider-preflight.cjs"
) > "$OUT/provider-preflight.json" || { echo "PREFLIGHT FAILED -- aborting"; exit 1; }
if [ "$MODE" = fresh ]; then
  docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>&1 | grep -v NOTICE || true
fi
rm -f "$OUT/provider-requests.ndjson"
(
  cd "$REPO/be"
  set -a; source "$REPO/.env"; source "$ENV_FILE"; set +a
  if [ "$MODE" = fresh ]; then npx prisma migrate deploy > "$OUT/migrate.log" 2>&1; fi
  echo "GROUNDED_SEARCH_PROVIDER=$GROUNDED_SEARCH_PROVIDER DISCOVERY_EXTRACTOR_PROVIDER=$DISCOVERY_EXTRACTOR_PROVIDER CLOUDFLARE_DISCOVERY_MODEL=$CLOUDFLARE_DISCOVERY_MODEL CLOUDFLARE_DISCOVERY_TIMEOUT_MS=$CLOUDFLARE_DISCOVERY_TIMEOUT_MS PLACES_PROVIDER=$PLACES_PROVIDER AI_PROVIDER=${AI_PROVIDER:-} CLASSIFICATION_PROVIDER=${CLASSIFICATION_PROVIDER:-} GEMINI_CLASSIFICATION_MODEL=${GEMINI_CLASSIFICATION_MODEL:-} AI_CACHE_MODE=$AI_CACHE_MODE USE_MOCK_MAPS=$USE_MOCK_MAPS MOCK_MAPS_MODE=$MOCK_MAPS_MODE OVERPASS_API_URL=$OVERPASS_API_URL NOMINATIM_API_URL=$NOMINATIM_API_URL" > "$OUT/provider-config.txt"
  REQUEST_COUNT_FILE="$OUT/provider-requests.ndjson" \
    node -r "$HERE/count-requests.cjs" dist/src/main.js > "$OUT/backend.log" 2>&1 &
  echo $! > "$OUT/backend.pid"
)
curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/" || true
grep -q "Nest application successfully started" "$OUT/backend.log"
: > "$OUT/provider-requests.ndjson"   # drop boot-time requests; count the run only
"$HERE/db-snapshot.sh" "$DB" > "$OUT/db-before.json"
date -u +%s > "$OUT/started-at.txt"
BASE_URL="http://localhost:$PORT" REQUEST_FILE="$HERE/request.json" OUT_DIR="$OUT" \
  RUN_LABEL="rw3-clean-$LABEL" node "$ORCH" > "$OUT/run.log" 2>&1 || true
date -u +%s > "$OUT/finished-at.txt"
sleep 5   # let trailing background requests (embeddings/media) land in the log
"$HERE/db-snapshot.sh" "$DB" > "$OUT/db-after.json"
kill "$(cat "$OUT/backend.pid")" || true
rm -f "$OUT/backend.pid"
echo "$LABEL done"
