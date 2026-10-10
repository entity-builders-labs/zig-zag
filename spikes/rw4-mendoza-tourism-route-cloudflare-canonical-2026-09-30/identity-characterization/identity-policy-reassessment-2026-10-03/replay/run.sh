#!/usr/bin/env bash
# RW4 identity policy replay (diagnostic; never COLD/WARM, never canonical).
# Real resolver + real providers on the real extracted hints of
# locality-recovery-2026-10-03/replay-gemini-7, against a disposable DB that
# holds only the published Overture AOI snapshot copied from the dev DB.
#   bash run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
DB=zigzag_rw4_policy_probe
SRC_DB=${SRC_DB:-zigzag}
MIGRATION="$REPO/be/prisma/migrations/20261003120000_add_overture_enumerated_extent/migration.sql"
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
export RUN_RW4_POLICY_REPLAY=1
npx prisma migrate deploy > /dev/null
# The dev DB predates the extent columns: copy the snapshot rows, then apply
# the migration's one-time manifest translation to them (proves the
# backfill on the real session).
docker exec zigzag-postgres sh -c "pg_dump -U postgres --data-only -t overture_places_import_session -t overture_place_index $SRC_DB | psql -q -U postgres -d $DB" > /dev/null
sed -n '/^UPDATE/,$p' "$MIGRATION" | docker exec -i zigzag-postgres psql -U postgres -q -d $DB
docker exec zigzag-postgres psql -U postgres -d $DB -Atc 'select id, "extentWest", "extentSouth", "extentEast", "extentNorth" from overture_places_import_session' > "$HERE/backfilled-extent.txt"
npx jest --config ./test/jest-live.json --runInBand rw4-identity-policy-replay
"$HERE/../../../db-snapshot.sh" "$DB" > "$HERE/db-after-probe.json"
node -e 'const d=require(process.argv[1]);for(const k of ["geoEntity","geoEntityIdentity","verifiedHintMemoryEntries","experience","experienceComponent"]) if(d[k]!==0){console.error("PERSISTED",k,d[k]);process.exit(1)}; console.log("no persistence: OK")' "$HERE/db-after-probe.json"
