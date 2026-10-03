#!/usr/bin/env bash
# RW4 contextual identity replay (diagnostic, read-only for canonical state).
# Real extractor (COLD #11 configuration) on the captured SolSalute window,
# then the real resolver + real OSM locality grounder on a fresh disposable
# DB holding only the already-imported Overture snapshot.
#   bash run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DB=zigzag_rw4_contextual_probe
SRC_DB=${SRC_DB:-zigzag}
docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>&1 | grep -v NOTICE || true
cd "$REPO/be"
set -a; source "$REPO/.env"; set +a
export PLACES_PROVIDER=geoapify
export DISCOVERY_EXTRACTOR_PROVIDER=${EXTRACTOR:-cloudflare}
export CLOUDFLARE_DISCOVERY_MODEL=@cf/qwen/qwen3.8-27b
export CLOUDFLARE_DISCOVERY_TIMEOUT_MS=60000
export CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS=4096
export OVERPASS_API_URL=http://localhost:12345/api/interpreter
export NOMINATIM_API_URL=http://localhost:8088/search
export NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/$DB"
export DIRECT_URL="$DATABASE_URL"
export USE_MOCK_MAPS=false MOCK_MAPS_MODE=strict AI_CACHE_MODE=off
export RUN_RW4_CONTEXTUAL_PROBE=1
export SPIKE_OUT_DIR=spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/contextual-identity-2026-10-03${RUN_SUFFIX:+/$RUN_SUFFIX}
npx prisma migrate deploy > /dev/null
docker exec zigzag-postgres sh -c "pg_dump -U postgres --data-only -t overture_places_import_session -t overture_place_index $SRC_DB | psql -q -U postgres -d $DB" > /dev/null
npx jest --config ./test/jest-live.json --runInBand rw4-contextual-identity
OUT="$REPO/$SPIKE_OUT_DIR"
"$HERE/../../db-snapshot.sh" "$DB" > "$OUT/db-after-probe.json"
node -e 'const d=require(process.argv[1]);for(const k of ["geoEntity","geoEntityIdentity","verifiedHintMemoryEntries","experience","experienceComponent"]) if(d[k]!==0){console.error("PERSISTED",k,d[k]);process.exit(1)}; console.log("no persistence: OK")' "$OUT/db-after-probe.json"
