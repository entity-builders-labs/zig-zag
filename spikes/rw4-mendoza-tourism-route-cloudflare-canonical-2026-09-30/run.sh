#!/usr/bin/env bash
# RW4 Mode C acceptance run: Mendoza Ruta del Vino tourism route
# Real HTTP product path (auth -> generate-tour -> outbox -> processor -> generation)
# on a dedicated spike DB, fresh backend whose outbound requests are counted by
# count-requests.cjs.
#
#   run.sh <label> <db> fresh|reuse <port> [tavily|cloudflare]
# fresh = drop/create/migrate the DB (COLD); reuse = same DB (WARM).
#
# Canonical runtime provenance (canonical-provenance.sh): the run refuses to
# start from a dirty checkout, builds the backend from HEAD for THIS run,
# launches it with BUILD_COMMIT=HEAD, and afterwards requires the trace's
# runtime.buildCommit and the manifest to report that same HEAD. Any mismatch
# marks the run NOT CANONICAL (provenance.json) and exits non-zero.
#
set -euo pipefail
LABEL="$1"; DB="$2"; MODE="$3"; PORT="$4"
RETRIEVAL_PROVIDER="${5:-tavily}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ORCH="$HERE/run-campaign.mjs"
OUT="$HERE/$LABEL"
# shellcheck source=canonical-provenance.sh
source "$HERE/canonical-provenance.sh"
mkdir -p "$OUT"

# --- Canonical provenance: BEFORE preflight, DB or any provider call --------
canonical_require_clean_checkout "$REPO" || { echo "NOT CANONICAL -- aborting before execution"; exit 1; }
SOURCE_HEAD="$(canonical_source_head "$REPO")"
SOURCE_BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
BUILD_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! canonical_build_backend "$REPO" 2>"$OUT/build.log"; then
  tail -20 "$OUT/build.log"
  echo "NOT CANONICAL -- aborting before execution"
  exit 1
fi
BUILD_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The build must not have changed the source it was built from.
canonical_require_clean_checkout "$REPO" || { echo "NOT CANONICAL -- build dirtied the checkout"; exit 1; }
[ "$(canonical_source_head "$REPO")" = "$SOURCE_HEAD" ] ||
  { canonical_fail "HEAD moved during the build"; exit 1; }
DIST_SHA256="$(canonical_dist_fingerprint "$REPO")"
write_provenance() { # $1 = canonical verdict (pending|true|false), $2 = reasons
  SOURCE_HEAD="$SOURCE_HEAD" SOURCE_BRANCH="$SOURCE_BRANCH" \
  BUILD_STARTED_AT="$BUILD_STARTED_AT" BUILD_FINISHED_AT="$BUILD_FINISHED_AT" \
  DIST_SHA256="$DIST_SHA256" VERDICT="$1" REASONS="$2" \
  node -e '
    const e = process.env;
    const out = {
      sourceHead: e.SOURCE_HEAD,
      sourceBranch: e.SOURCE_BRANCH,
      buildCommand: "cd be && yarn build",
      buildStartedAt: e.BUILD_STARTED_AT,
      buildFinishedAt: e.BUILD_FINISHED_AT,
      runtimeEntry: "be/dist/src/main.js",
      distSha256: e.DIST_SHA256,
      canonical: e.VERDICT === "pending" ? "pending" : e.VERDICT === "true",
      failures: e.REASONS ? e.REASONS.split("\n").filter(Boolean) : [],
    };
    console.log(JSON.stringify(out, null, 2));
  ' > "$OUT/provenance.json"
}
write_provenance pending ""

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<ENV
GROUNDED_SEARCH_PROVIDER=serper
DISCOVERY_EXTRACTOR_PROVIDER=${DISCOVERY_EXTRACTOR_PROVIDER:-cloudflare}
GROQ_DISCOVERY_MODEL=${GROQ_DISCOVERY_MODEL:-qwen/qwen3.8-27b}
CLOUDFLARE_DISCOVERY_MODEL=@cf/qwen/qwen3.8-27b
CLOUDFLARE_DISCOVERY_TIMEOUT_MS=60000
CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS=${CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS:-4096}
WEB_SOURCE_CONTENT_PROVIDER=$RETRIEVAL_PROVIDER
PLACES_PROVIDER=geoapify
OVERPASS_API_URL=http://localhost:12345/api/interpreter
NOMINATIM_API_URL=http://localhost:8088/search
NOMINATIM_REVERSE_API_URL=http://localhost:8088/reverse
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/$DB
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/$DB
USE_MOCK_MAPS=false
MOCK_MAPS_MODE=strict
AI_CACHE_MODE=off
CLASSIFICATION_PROVIDER=${CLASSIFICATION_PROVIDER:-gemini}
GEMINI_CLASSIFICATION_MODEL=${GEMINI_CLASSIFICATION_MODEL:-gemini-3.5-flash-lite}
PORT=$PORT
BUILD_COMMIT=$SOURCE_HEAD
BUILD_TIMESTAMP=$BUILD_FINISHED_AT
CANONICAL_SOURCE_HEAD=$SOURCE_HEAD
CANONICAL_SOURCE_BRANCH=$SOURCE_BRANCH
CANONICAL_DIST_SHA256=$DIST_SHA256
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
# The runtime about to launch must be exactly the tree built above.
[ "$(canonical_dist_fingerprint "$REPO")" = "$DIST_SHA256" ] ||
  { canonical_fail "dist changed between build and launch"; exit 1; }
(
  cd "$REPO/be"
  set -a; source "$REPO/.env"; source "$ENV_FILE"; set +a
  if [ "$MODE" = fresh ]; then npx prisma migrate deploy > "$OUT/migrate.log" 2>&1; fi
  echo "GROUNDED_SEARCH_PROVIDER=$GROUNDED_SEARCH_PROVIDER DISCOVERY_EXTRACTOR_PROVIDER=$DISCOVERY_EXTRACTOR_PROVIDER CLOUDFLARE_DISCOVERY_MODEL=$CLOUDFLARE_DISCOVERY_MODEL CLOUDFLARE_DISCOVERY_TIMEOUT_MS=$CLOUDFLARE_DISCOVERY_TIMEOUT_MS CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS=$CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS WEB_SOURCE_CONTENT_PROVIDER=$WEB_SOURCE_CONTENT_PROVIDER PLACES_PROVIDER=$PLACES_PROVIDER AI_PROVIDER=${AI_PROVIDER:-} CLASSIFICATION_PROVIDER=${CLASSIFICATION_PROVIDER:-} GEMINI_CLASSIFICATION_MODEL=${GEMINI_CLASSIFICATION_MODEL:-} AI_CACHE_MODE=$AI_CACHE_MODE USE_MOCK_MAPS=$USE_MOCK_MAPS MOCK_MAPS_MODE=$MOCK_MAPS_MODE OVERPASS_API_URL=$OVERPASS_API_URL NOMINATIM_API_URL=$NOMINATIM_API_URL BUILD_COMMIT=$BUILD_COMMIT BUILD_TIMESTAMP=$BUILD_TIMESTAMP" > "$OUT/provider-config.txt"
  REQUEST_COUNT_FILE="$OUT/provider-requests.ndjson" \
    node -r "$HERE/count-requests.cjs" dist/src/main.js > "$OUT/backend.log" 2>&1 &
  echo $! > "$OUT/backend.pid"
)
curl -s -o /dev/null --retry 60 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/" || true
grep -q "Nest application successfully started" "$OUT/backend.log"
: > "$OUT/provider-requests.ndjson"   # drop boot-time requests; count the run only
"$HERE/db-snapshot.sh" "$DB" > "$OUT/db-before.json"
date -u +%s > "$OUT/started-at.txt"
(
  set -a; source "$ENV_FILE"; set +a
  BASE_URL="http://localhost:$PORT" REQUEST_FILE="$HERE/request.json" OUT_DIR="$OUT" \
    RUN_LABEL="rw4-mendoza-$LABEL" node "$ORCH" > "$OUT/run.log" 2>&1 || true
)
date -u +%s > "$OUT/finished-at.txt"
sleep 5   # let trailing background requests (embeddings/media) land in the log
"$HERE/db-snapshot.sh" "$DB" > "$OUT/db-after.json"
kill "$(cat "$OUT/backend.pid")" || true
rm -f "$OUT/backend.pid"

# --- Canonical provenance verdict ------------------------------------------
REASONS=""
record_failure() { REASONS="${REASONS}$1"$'\n'; }
canonical_verify_runtime_commit "$OUT/generation-trace.json" "$SOURCE_HEAD" 2>>"$OUT/provenance.log" ||
  record_failure "trace runtime.buildCommit does not equal source HEAD"
canonical_verify_manifest_commit "$OUT/run-manifest.json" "$SOURCE_HEAD" 2>>"$OUT/provenance.log" ||
  record_failure "run manifest provenance does not equal source HEAD"
canonical_require_clean_checkout "$REPO" 2>>"$OUT/provenance.log" ||
  record_failure "checkout no longer clean after the run"
[ "$(canonical_source_head "$REPO")" = "$SOURCE_HEAD" ] ||
  record_failure "HEAD moved during the run"
[ "$(canonical_dist_fingerprint "$REPO")" = "$DIST_SHA256" ] ||
  record_failure "dist changed during the run"
if [ -n "$REASONS" ]; then
  write_provenance false "$REASONS"
  cat "$OUT/provenance.log" >&2 || true
  echo "$LABEL done -- NOT CANONICAL (see $OUT/provenance.json)"
  exit 4
fi
write_provenance true ""
echo "$LABEL done -- canonical provenance verified for $SOURCE_HEAD"
