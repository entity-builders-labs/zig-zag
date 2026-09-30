#!/usr/bin/env bash
# Deterministic tests for canonical-provenance.sh. Every case runs against a
# throwaway git repository with a stub be/package.json build script, so the
# result never depends on the developer's real checkout or on the backend.
#
#   bash canonical-provenance.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=canonical-provenance.sh
source "$HERE/canonical-provenance.sh"

PASS=0; FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
expect_pass() { local name="$1"; shift; if "$@" 2>/dev/null; then ok "$name"; else fail "$name"; fi; }
expect_fail() { local name="$1"; shift; if "$@" 2>/dev/null; then fail "$name"; else ok "$name"; fi; }

# $1 = build script placed in be/package.json
new_repo() {
  local repo
  repo="$(mktemp -d "$WORK/repo.XXXX")"
  mkdir -p "$repo/be/src"
  printf '{"name":"stub-be","private":true,"scripts":{"build":"%s"}}\n' "$1" > "$repo/be/package.json"
  echo 'export {};' > "$repo/be/src/main.ts"
  printf 'dist/\n' > "$repo/be/.gitignore"
  git -C "$repo" init -q
  git -C "$repo" -c user.email=t@t -c user.name=t add -A
  git -C "$repo" -c user.email=t@t -c user.name=t commit -qm init
  echo "$repo"
}
GOOD_BUILD='mkdir -p dist/src && echo built > dist/src/main.js'

echo "clean-checkout gate"
R="$(new_repo "$GOOD_BUILD")"
expect_pass "clean checkout is accepted" canonical_require_clean_checkout "$R"
mkdir -p "$R/spikes/other" && echo x > "$R/spikes/other/untracked.txt"
expect_pass "untracked files outside be/ are ignored" canonical_require_clean_checkout "$R"
echo 'export const x = 1;' > "$R/be/src/main.ts"
expect_fail "unstaged tracked change is refused" canonical_require_clean_checkout "$R"
git -C "$R" add be/src/main.ts
expect_fail "staged uncommitted change is refused" canonical_require_clean_checkout "$R"
R="$(new_repo "$GOOD_BUILD")"
echo 'export {};' > "$R/be/src/new-file.ts"
expect_fail "untracked file under be/ is refused" canonical_require_clean_checkout "$R"
expect_fail "a directory without git HEAD is refused" canonical_require_clean_checkout "$(mktemp -d "$WORK/nogit.XXXX")"

echo "fresh build gate"
R="$(new_repo "$GOOD_BUILD")"
expect_pass "fresh build is accepted" canonical_build_backend "$R"
expect_pass "build leaves the checkout clean" canonical_require_clean_checkout "$R"
R="$(new_repo 'exit 3')"
expect_fail "failing build is refused" canonical_build_backend "$R"
R="$(new_repo 'true')"
expect_fail "build without an entry point is refused" canonical_build_backend "$R"
R="$(new_repo 'true')"
mkdir -p "$R/be/dist/src" && echo stale > "$R/be/dist/src/main.js"
touch -t 202001010000 "$R/be/dist/src/main.js"
expect_fail "stale prebuilt dist is refused" canonical_build_backend "$R"

echo "dist fingerprint"
R="$(new_repo "$GOOD_BUILD")"
canonical_build_backend "$R" 2>/dev/null
F1="$(canonical_dist_fingerprint "$R")"
F2="$(canonical_dist_fingerprint "$R")"
if [ -n "$F1" ] && [ "$F1" = "$F2" ]; then ok "fingerprint is deterministic"; else fail "fingerprint is deterministic"; fi
echo changed > "$R/be/dist/src/main.js"
if [ "$(canonical_dist_fingerprint "$R")" != "$F1" ]; then ok "fingerprint changes with dist content"; else fail "fingerprint changes with dist content"; fi

echo "runtime build commit"
HEAD_SHA="$(canonical_source_head "$R")"
T="$WORK/trace-match.json";   printf '{"runtime":{"buildCommit":"%s"}}' "$HEAD_SHA" > "$T"
expect_pass "trace reporting source HEAD is accepted" canonical_verify_runtime_commit "$T" "$HEAD_SHA"
T="$WORK/trace-unknown.json"; printf '{"runtime":{"buildCommit":"unknown"}}' > "$T"
expect_fail "trace reporting 'unknown' is refused" canonical_verify_runtime_commit "$T" "$HEAD_SHA"
T="$WORK/trace-missing.json"; printf '{"steps":[]}' > "$T"
expect_fail "trace without runtime.buildCommit is refused" canonical_verify_runtime_commit "$T" "$HEAD_SHA"
T="$WORK/trace-other.json";   printf '{"runtime":{"buildCommit":"0000000000000000000000000000000000000000"}}' > "$T"
expect_fail "trace reporting another commit is refused" canonical_verify_runtime_commit "$T" "$HEAD_SHA"
expect_fail "missing trace file is refused" canonical_verify_runtime_commit "$WORK/absent.json" "$HEAD_SHA"
expect_fail "empty expected HEAD is refused" canonical_verify_runtime_commit "$WORK/trace-match.json" ""

echo "manifest provenance"
M="$WORK/manifest-ok.json"; printf '{"provenance":{"sourceHead":"%s","buildCommit":"%s"}}' "$HEAD_SHA" "$HEAD_SHA" > "$M"
expect_pass "manifest agreeing with source HEAD is accepted" canonical_verify_manifest_commit "$M" "$HEAD_SHA"
M="$WORK/manifest-build.json"; printf '{"provenance":{"sourceHead":"%s","buildCommit":"unknown"}}' "$HEAD_SHA" > "$M"
expect_fail "manifest with a different build commit is refused" canonical_verify_manifest_commit "$M" "$HEAD_SHA"
M="$WORK/manifest-none.json"; printf '{"runLabel":"x"}' > "$M"
expect_fail "manifest without provenance is refused" canonical_verify_manifest_commit "$M" "$HEAD_SHA"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
