#!/usr/bin/env bash
# Second bounded COLD only (extractor variance produced no partial composite
# in the first COLD). Same request, fresh dedicated DB, serper.
set -euo pipefail
PORT="${1:-4013}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SPIKES="$REPO/spikes"
DB="zigzag_spike_stage4_partial_composite_cold2"
ORCH="$SPIKES/stage3-simple-composite-mixed-2026-09-23/run-campaign.mjs"
COUNTS="$SPIKES/stage3-simple-composite-mixed-2026-09-23/catalog-counts.sh"
OUT="$HERE/cold2"
docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
ENV_FILE="$OUT/.env.spike"
cat > "$ENV_FILE" <<ENV
GROUNDED_SEARCH_PROVIDER=serper
OVERPASS_API_URL=http://localhost:12345/api/interpreter
NOMINATIM_API_URL=http://localhost:8088/search
NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/$DB
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/$DB
USE_MOCK_MAPS=false
MOCK_MAPS_MODE=strict
AI_CACHE_MODE=off
PLACES_PROVIDER=geoapify
PORT=$PORT
ENV
(
  cd "$REPO/be"
  set -a; source "$REPO/.env"; source "$ENV_FILE"; set +a
  npx prisma migrate deploy > "$OUT/migrate.log" 2>&1
  node dist/src/main.js > "$OUT/backend.log" 2>&1 &
  echo $! > "$OUT/backend.pid"
)
curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/" || true
grep -q "Nest application successfully started" "$OUT/backend.log"
"$COUNTS" "$DB" > "$OUT/counts-before.json"
BASE_URL="http://localhost:$PORT" REQUEST_FILE="$HERE/request.json" OUT_DIR="$OUT/run" \
  RUN_LABEL="stage4-cold2" node "$ORCH" > "$OUT/run.log" 2>&1 || true
"$COUNTS" "$DB" > "$OUT/counts-after.json"
kill "$(cat "$OUT/backend.pid")" || true
rm -f "$ENV_FILE" "$OUT/backend.pid"
echo "cold2 done"
