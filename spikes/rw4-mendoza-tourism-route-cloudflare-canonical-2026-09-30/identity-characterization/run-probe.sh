#!/usr/bin/env bash
# RW4 identity characterization probe (diagnostic, read-only for canonical state).
# Same provider configuration as run.sh (local Nominatim/Overpass, Geoapify,
# Wikidata, AI_CACHE_MODE=off) on a FRESH disposable DB that the probe never
# writes: the resolver runs with a stub catalog (see the live spec).
#   bash run-probe.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DB=zigzag_rw4_identity_probe
docker exec zigzag-postgres psql -U postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>&1 | grep -v NOTICE || true
cd "$REPO/be"
set -a; source "$REPO/.env"; set +a
export PLACES_PROVIDER=geoapify
export OVERPASS_API_URL=http://localhost:12345/api/interpreter
export NOMINATIM_API_URL=http://localhost:8088/search
export NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/$DB"
export DIRECT_URL="$DATABASE_URL"
export USE_MOCK_MAPS=false MOCK_MAPS_MODE=strict AI_CACHE_MODE=off
export RUN_RW4_IDENTITY_PROBE=1
export SPIKE_OUT_DIR="spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization"
npx prisma migrate deploy > /dev/null
npx jest --config ./test/jest-live.json --runInBand rw4-identity-characterization
# Prove nothing was persisted (same snapshot tool as the canonical runs).
"$HERE/../db-snapshot.sh" "$DB" > "$HERE/db-after-probe.json"
node -e 'const d=require(process.argv[1]);for(const k of ["geoEntity","geoEntityIdentity","verifiedHintMemoryEntries","experience","experienceComponent"]) if(d[k]!==0){console.error("PERSISTED",k,d[k]);process.exit(1)}; console.log("no persistence: OK")' "$HERE/db-after-probe.json"
