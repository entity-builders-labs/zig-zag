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
# $1 = intents, $2 = facets, $3 = workUnits JSON array
trace() {
  cat > "$WORK/t.json" <<JSON
{"canonicalRequest":{"intent":{"interests":["wine"],"intents":$1}},
 "steps":[{"name":"request.intent","facts":{"facets":$2}},
          {"name":"acquisition.routing","output":{"workUnits":$3}}]}
JSON
  echo "$WORK/t.json"
}
F_WINE='{"dimension":"theme","key":"wine","source":"wizard"}'
F_ROUTE='{"dimension":"intent","key":"route_like","source":"wizard"}'
F_VISIT='{"dimension":"intent","key":"visit","source":"wizard"}'
F_VISIT_FT='{"dimension":"intent","key":"visit","source":"free_text"}'
F_WALK_FT='{"dimension":"intent","key":"walk","source":"free_text"}'
D_WINE='{"dimension":"theme","key":"wine"}'
D_VISIT='{"dimension":"intent","key":"visit"}'
D_WALK='{"dimension":"intent","key":"walk"}'
NONE='{"kind":"NONE"}'
ARW_ROUTE='{"kind":"AREA_ROUTE_WALK","deficit":{"dimension":"intent","key":"route_like"},"geographicGrant":{"kind":"OWNED_INTENT","intent":"route_like"}}'
ARW_WALK='{"kind":"AREA_ROUTE_WALK","deficit":{"dimension":"intent","key":"walk"},"geographicGrant":{"kind":"OWNED_INTENT","intent":"walk"}}'
GENERIC_OK="{\"kind\":\"GENERIC\",\"deficits\":[$D_WINE,$D_VISIT],\"geographicGrant\":$NONE}"

echo "request mode"
expect_pass "fixture request.json passes" node "$GATE" request "$HERE/request.json"
expect_pass "wine + route_like + visit passes" node "$GATE" request "$(request '["route_like","visit"]' '["wine"]')"
expect_fail "missing visit fails (COLD #7/#8 fixture)" node "$GATE" request "$(request '["route_like"]' '["wine"]')"
expect_fail "missing route_like fails" node "$GATE" request "$(request '["visit"]' '["wine"]')"
expect_fail "missing wine fails" node "$GATE" request "$(request '["route_like","visit"]' '[]')"

echo "trace mode"
expect_pass "explicit wizard facets + expected work units pass" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$ARW_ROUTE,$GENERIC_OK]")"
expect_pass "free-text walk owned by its own unit is a valid multi-intent request" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT,$F_WALK_FT]" "[$ARW_ROUTE,$ARW_WALK,$GENERIC_OK]")"
expect_fail "visit only from free text fails (COLD #7 shape)" node "$GATE" trace \
  "$(trace '["route_like"]' "[$F_WINE,$F_ROUTE,$F_VISIT_FT]" "[$ARW_ROUTE,$GENERIC_OK]")"
expect_fail "generic unit without visit fails (COLD #8 shape)" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$ARW_ROUTE,{\"kind\":\"GENERIC\",\"deficits\":[$D_WINE],\"geographicGrant\":$NONE}]")"
expect_fail "route_like not owned by AREA_ROUTE_WALK fails" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$GENERIC_OK]")"
expect_fail "walk coalesced into GENERIC fails" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT,$F_WALK_FT]" "[$ARW_ROUTE,{\"kind\":\"GENERIC\",\"deficits\":[$D_WINE,$D_VISIT,$D_WALK],\"geographicGrant\":$NONE}]")"
expect_fail "GENERIC unit with a grant fails" node "$GATE" trace \
  "$(trace '["route_like","visit"]' "[$F_WINE,$F_ROUTE,$F_VISIT]" "[$ARW_ROUTE,{\"kind\":\"GENERIC\",\"deficits\":[$D_WINE,$D_VISIT],\"geographicGrant\":{\"kind\":\"OWNED_INTENT\",\"intent\":\"route_like\"}}]")"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
