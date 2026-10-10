#!/usr/bin/env bash
# Stage 4 bounded live control: one COLD on a fresh dedicated DB, then one
# WARM on the same DB, through the real HTTP path (auth -> generate-tour ->
# outbox -> processor -> generation). Reuses the Stage 3 orchestrator,
# catalog counter and analyzer; only the grounded-search provider differs
# (serper: SerpApi quota is exhausted and must not be called).
set -euo pipefail
PORT="${1:-4012}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SPIKES="$REPO/spikes"
DB="zigzag_spike_stage4_partial_composite"
ORCH="$SPIKES/stage3-simple-composite-mixed-2026-09-23/run-campaign.mjs"
COUNTS="$SPIKES/stage3-simple-composite-mixed-2026-09-23/catalog-counts.sh"
ANALYZE="$SPIKES/stage3-buenosaires-walks-mega-control-2026-09-24/analyze-run.py"

docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
ENV_FILE="$HERE/.env.spike"
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
  npx prisma migrate deploy > "$HERE/migrate.log" 2>&1
  node dist/src/main.js > "$HERE/backend.log" 2>&1 &
  echo $! > "$HERE/backend.pid"
)
curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/" || true
grep -q "Nest application successfully started" "$HERE/backend.log"
"$COUNTS" "$DB" > "$HERE/counts-before-cold.json"
BASE_URL="http://localhost:$PORT" REQUEST_FILE="$HERE/request.json" OUT_DIR="$HERE/cold" \
  RUN_LABEL="stage4-cold" node "$ORCH" > "$HERE/cold-run.log" 2>&1 || true
"$COUNTS" "$DB" > "$HERE/counts-after-cold.json"
BASE_URL="http://localhost:$PORT" REQUEST_FILE="$HERE/request.json" OUT_DIR="$HERE/warm" \
  RUN_LABEL="stage4-warm" node "$ORCH" > "$HERE/warm-run.log" 2>&1 || true
"$COUNTS" "$DB" > "$HERE/counts-after-warm.json"
kill "$(cat "$HERE/backend.pid")" || true
rm -f "$ENV_FILE" "$HERE/backend.pid"
python3 "$ANALYZE" "$HERE/cold" "$DB" --label stage4-cold > "$HERE/cold-metrics.json" || true
python3 "$ANALYZE" "$HERE/warm" "$DB" --label stage4-warm > "$HERE/warm-metrics.json" || true
echo "stage4 live control done"
