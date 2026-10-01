#!/usr/bin/env bash
# Deterministic tests for request-stimulus.cjs (input gate only).
#
#   bash request-stimulus.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/request-stimulus.cjs"
PASS=0; FAIL=0
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
expect_pass() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$n"; else fail "$n"; fi; }
expect_fail() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then fail "$n"; else ok "$n"; fi; }

# $1 = intents JSON array, $2 = interests JSON array
request() { echo "{\"intent\":{\"interests\":$2,\"intents\":$1}}" > "$WORK/r.json"; echo "$WORK/r.json"; }
# $1 = intents, $2 = facets, $3 = generic deficits, $4 = area_route_walk deficits
trace() {
  cat > "$WORK/t.json" <<JSON
{"canonicalRequest":{"intent":{"interests":["wine"],"intents":$1}},
 "steps":[{"name":"request.intent","facts":{"facets":$2}},
          {"name":"acquisition.routing","output":{"generic":$3,"areaRouteWalk":$4}}]}
JSON
  echo "$WORK/t.json"
}
F_WINE='{"dimension":"theme","key":"wine","source":"wizard"}'
F_ROUTE='{"dimension":"intent","key":"route_like","source":"wizard"}'
F_VISIT='{"dimension":"intent","key":"visit","source":"wizard"}'
F_VISIT_FT='{"dimension":"intent","key":"visit","source":"free_text"}'
D_WINE='{"dimension":"theme","key":"wine"}'
D_VISIT='{"dimension":"intent","key":"visit"}'
ARW='[{"deficit":{"dimension":"intent","key":"route_like"}}]'

echo "request mode"
expect_pass "fixture request.json passes" node "$GATE" request "$HERE/request.json"
expect_pass "wine + route_like + visit passes" node "$GATE" request "$(request '["route_like","visit"]' '["wine"]')"
expect_fail "missing visit fails (COLD #7/#8 fixture)" node "$GATE" request "$(request '["route_like"]' '["wine"]')"
expect_fail "missing route_like fails" node "$GATE" request "$(request '["visit"]' '["wine"]')"
expect_fail "missing wine fails" node "$GATE" request "$(request '["route_like","visit"]' '[]')"

echo "trace mode"
expect_pass "explicit wizard facets + expected partition pass" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$D_WINE,$D_VISIT]" "$ARW")"
expect_fail "visit only from free text fails (COLD #7 shape)" node "$GATE" trace \
  "$(trace '["route_like"]' "[$F_WINE,$F_ROUTE,$F_VISIT_FT]" "[$D_WINE,$D_VISIT]" "$ARW")"
expect_fail "generic partition without visit fails (COLD #8 shape)" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$D_WINE]" "$ARW")"
expect_fail "route_like not routed to area_route_walk fails" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$D_WINE,$D_VISIT]" '[]')"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
