#!/usr/bin/env bash
# Spike-only driver: one campaign = COLD on a fresh dedicated DB, then WARM on
# the same DB (no reset), both through the real HTTP path
# (auth -> /tours/generate-tour -> outbox -> processor -> generation).
# A dedicated backend process (built dist/, env layered from the repo .env +
# the spike overrides) serves each campaign on its own port.
#
# Usage: run-campaign-pair.sh <campaign-dir-name> <port>
set -euo pipefail
CAMPAIGN="$1"
PORT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SPIKES="$REPO/spikes"
DIR="$HERE/$CAMPAIGN"
DB="zigzag_spike_bamega_${CAMPAIGN//-/_}"
ORCH="$SPIKES/stage3-simple-composite-mixed-2026-09-23/run-campaign.mjs"
COUNTS="$SPIKES/stage3-simple-composite-mixed-2026-09-23/catalog-counts.sh"

mkdir -p "$DIR"
docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"

ENV_FILE="$DIR/.env.spike"
cat > "$ENV_FILE" <<EOF
GROUNDED_SEARCH_PROVIDER=serpapi
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
EOF

(
  cd "$REPO/be"
  set -a; source "$REPO/.env"; source "$ENV_FILE"; set +a
  npx prisma migrate deploy > "$DIR/migrate.log" 2>&1
  node dist/src/main.js > "$DIR/backend.log" 2>&1 &
  echo $! > "$DIR/backend.pid"
)
curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/" || true
grep -q "Nest application successfully started" "$DIR/backend.log"

"$COUNTS" "$DB" > "$DIR/counts-before-cold.json"
BASE_URL="http://localhost:$PORT" REQUEST_FILE="$DIR/request.json" OUT_DIR="$DIR/cold" \
  RUN_LABEL="$CAMPAIGN-cold" node "$ORCH" > "$DIR/cold-run.log" 2>&1 || true
"$COUNTS" "$DB" > "$DIR/counts-after-cold.json"

BASE_URL="http://localhost:$PORT" REQUEST_FILE="$DIR/request.json" OUT_DIR="$DIR/warm" \
  RUN_LABEL="$CAMPAIGN-warm" node "$ORCH" > "$DIR/warm-run.log" 2>&1 || true
"$COUNTS" "$DB" > "$DIR/counts-after-warm.json"

kill "$(cat "$DIR/backend.pid")" || true
rm -f "$ENV_FILE"

python3 "$HERE/analyze-run.py" "$DIR/cold" "$DB" --label "$CAMPAIGN-cold" > "$DIR/cold-metrics.json" || true
python3 "$HERE/analyze-run.py" "$DIR/warm" "$DB" --label "$CAMPAIGN-warm" > "$DIR/warm-metrics.json" || true
echo "$CAMPAIGN done"
