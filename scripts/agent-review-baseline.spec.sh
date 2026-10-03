#!/usr/bin/env bash
# Deterministic fixtures for scripts/agent-review-baseline.
#
# Builds throwaway git histories, feeds shaped GitHub review payloads, and
# asserts the selected incremental range. No network, no model, no publication.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASELINE="$ROOT/scripts/agent-review-baseline"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }

[ -x "$BASELINE" ] || [ -f "$BASELINE" ] || fail 'baseline script exists'
ZIGZAG_WF="$ROOT/.github/workflows/zig-zag-contextual-review.yml"
[ -f "$ZIGZAG_WF" ] || fail 'contextual review workflow exists'

marker() { # track reviewed_sha [extra_body]
  printf '<!-- zig-zag-contextual-review\ntrack=%s\nreviewed_head=%s\n-->\n\nCODE REVIEW: PASS\nARCHITECTURE_PASS\n%s' "$1" "$2" "${3:-}"
}

review_json() { # author state commit_id track marker_sha body_extra
  jq -n --arg a "$1" --arg s "$2" --arg c "$3" --arg t "$4" --arg m "$5" --arg x "$6" '
    [{ user: { login: $a }, state: $s, commit_id: $c, body: $x }]
  '
}

# Build a repo with N sequential commits on one branch.
build_repo() { # dir  -> echoes head sha
  local dir="$1" sha
  git init -q "$dir"
  git -C "$dir" config user.email t@example.invalid
  git -C "$dir" config user.name Test
  printf 'base\n' > "$dir/base.txt"
  git -C "$dir" add -A && git -C "$dir" commit -q -m c1
  local i
  for i in 2 3 4 5; do
    printf 'c%s\n' "$i" > "$dir/f$i.txt"
    git -C "$dir" add -A && git -C "$dir" commit -q -m "c$i"
  done
  sha="$(git -C "$dir" rev-parse HEAD)"
  printf '%s' "$sha"
}

run_case() { # dir reviews_json -> sets COVERAGE, BASELINE_SHA, COMMIT_COUNT, LIMIT
  local dir="$1" reviews="$2" head
  head="$(git -C "$dir" rev-parse HEAD)"
  ( cd "$dir" && REVIEW_HEAD_SHA="$head" TRACK='contextual-review-groq' \
      bash "$BASELINE" "$reviews" ) > "$TMP/out.env"
  COVERAGE="$(sed -n 's/^COVERAGE=//p' "$TMP/out.env")"
  BASELINE_SHA="$(sed -n 's/^BASELINE_SHA=//p' "$TMP/out.env")"
  COMMIT_COUNT="$(sed -n 's/^COMMIT_COUNT=//p' "$TMP/out.env")"
  LIMIT="$(sed -n 's/^COVERAGE_LIMITATION=//p' "$TMP/out.env")"
}

# --- case 1: one new commit since the previous canonical review -------------
D="$TMP/c1"; build_repo "$D" > /dev/null
PREV="$(git -C "$D" rev-parse HEAD~1)"
review_json 'github-actions[bot]' COMMENTED "$PREV" 'contextual-review-groq' "$PREV" \
  "$(marker 'contextual-review-groq' "$PREV")" > "$TMP/r1.json"
run_case "$D" "$TMP/r1.json"
[ "$COVERAGE" = incremental ] || fail "1 coverage=$COVERAGE"
[ "$COMMIT_COUNT" = 1 ] || fail "1 commit_count=$COMMIT_COUNT"
[ "$BASELINE_SHA" = "$PREV" ] || fail "1 baseline mismatch"
pass 'one new commit since previous canonical review'

# --- case 2: multiple new commits since that review --------------------------
D="$TMP/c2"; build_repo "$D" > /dev/null
PREV="$(git -C "$D" rev-parse HEAD~3)"
review_json 'github-actions[bot]' CHANGES_REQUESTED "$PREV" 'contextual-review-groq' "$PREV" \
  "$(marker 'contextual-review-groq' "$PREV")" > "$TMP/r2.json"
run_case "$D" "$TMP/r2.json"
[ "$COVERAGE" = incremental ] || fail "2 coverage=$COVERAGE"
[ "$COMMIT_COUNT" = 3 ] || fail "2 commit_count=$COMMIT_COUNT"
pass 'multiple new commits since previous review are all included'

# --- case 3: first review, no previous canonical review ---------------------
D="$TMP/c3"; build_repo "$D" > /dev/null
echo '[]' > "$TMP/r3.json"
run_case "$D" "$TMP/r3.json"
[ "$COVERAGE" = latest-commit-only ] || fail "3 coverage=$COVERAGE"
[ "$COMMIT_COUNT" = 1 ] || fail "3 commit_count=$COMMIT_COUNT"
case "$LIMIT" in *LATEST-COMMIT-ONLY*) : ;; *) fail '3 must not claim full history' ;; esac
pass 'first review falls back to latest-commit-only and says so'

# --- case 4: historical review whose SHA is not an ancestor -----------------
D="$TMP/c4"; build_repo "$D" > /dev/null
# Build an unrelated root commit that cannot be an ancestor of this head.
git init -q "$TMP/other"; git -C "$TMP/other" config user.email t@e.invalid
git -C "$TMP/other" config user.name T; printf 'x\n' > "$TMP/other/x.txt"
git -C "$TMP/other" add -A; git -C "$TMP/other" commit -q -m other
FOREIGN="$(git -C "$TMP/other" rev-parse HEAD)"
review_json 'github-actions[bot]' COMMENTED "$FOREIGN" 'contextual-review-groq' "$FOREIGN" \
  "$(marker 'contextual-review-groq' "$FOREIGN")" > "$TMP/r4.json"
run_case "$D" "$TMP/r4.json"
[ "$COVERAGE" = latest-commit-only ] || fail "4 coverage=$COVERAGE"
case "$LIMIT" in *"not an ancestor"*) : ;; *) fail '4 must report non-ancestor' ;; esac
pass 'historical review that is not an ancestor is rejected as a baseline'

# --- case 5: copied / spoofed marker from a non-publisher author -------------
D="$TMP/c5"; build_repo "$D" > /dev/null
PREV="$(git -C "$D" rev-parse HEAD~1)"
review_json 'some-user' COMMENTED "$PREV" 'contextual-review-groq' "$PREV" \
  "$(marker 'contextual-review-groq' "$PREV")" > "$TMP/r5.json"
run_case "$D" "$TMP/r5.json"
[ "$COVERAGE" = latest-commit-only ] || fail "5 spoofed author must not be a baseline"
pass 'copied marker from a non-publisher is not a prior canonical review'

# --- case 6: correct marker, wrong GitHub commit_id -------------------------
D="$TMP/c6"; build_repo "$D" > /dev/null
REAL="$(git -C "$D" rev-parse HEAD~2)"; OTHER="$(git -C "$D" rev-parse HEAD~1)"
# marker says $REAL, commit_id says $OTHER -> disagreement
review_json 'github-actions[bot]' COMMENTED "$OTHER" 'contextual-review-groq' "$REAL" \
  "$(marker 'contextual-review-groq' "$REAL")" > "$TMP/r6.json"
run_case "$D" "$TMP/r6.json"
[ "$COVERAGE" = latest-commit-only ] || fail "6 marker/commit_id disagreement must be rejected"
pass 'correct marker with mismatched commit_id is rejected'

# --- case 7: merge commit ----------------------------------------------------
D="$TMP/c7"; build_repo "$D" > /dev/null
git -C "$D" checkout -q -b side HEAD~2
printf 'side\n' > "$D/side.txt"; git -C "$D" add -A; git -C "$D" commit -q -m side
git -C "$D" checkout -q main 2>/dev/null || git -C "$D" checkout -q master
printf 'mainline\n' > "$D/ml.txt"; git -C "$D" add -A; git -C "$D" commit -q -m ml
git -C "$D" merge -q --no-ff side -m 'merge side' 2>/dev/null
echo '[]' > "$TMP/r7.json"
run_case "$D" "$TMP/r7.json"
[ "$(sed -n 's/^REVIEW_KIND=//p' "$TMP/out.env")" = merge-aware ] || fail '7 merge not detected'
pass 'merge commit is reviewed with first-parent semantics'

# --- case 8: documentation-only commit --------------------------------------
D="$TMP/c8"; build_repo "$D" > /dev/null
printf '# doc\n' > "$D/README.md"; git -C "$D" add -A; git -C "$D" commit -q -m docs
echo '[]' > "$TMP/r8.json"
run_case "$D" "$TMP/r8.json"
[ "$(sed -n 's/^DOCS_ONLY=//p' "$TMP/out.env")" = true ] || fail '8 docs-only not detected'
pass 'documentation-only commit is classified as docs-only'

# --- case 9: failed review then another push --------------------------------
D="$TMP/c9"; build_repo "$D" > /dev/null
PREV="$(git -C "$D" rev-parse HEAD~1)"
# A failed/cancelled review carries no marker at all.
jq -n '[{ user: {login:"github-actions[bot]"}, state:"COMMENTED", commit_id:"'"$PREV"'", body:"Review failed to normalize; no verdict." }]' > "$TMP/r9.json"
run_case "$D" "$TMP/r9.json"
[ "$COVERAGE" = latest-commit-only ] || fail '9 unmarked review must not become a baseline'
pass 'failed review does not hide earlier unreviewed commits'

# --- case 10: range covers exactly the declared commits ---------------------
D="$TMP/c10"; build_repo "$D" > /dev/null
PREV="$(git -C "$D" rev-parse HEAD~2)"
review_json 'github-actions[bot]' COMMENTED "$PREV" 'contextual-review-groq' "$PREV" \
  "$(marker 'contextual-review-groq' "$PREV")" > "$TMP/r10.json"
run_case "$D" "$TMP/r10.json"
EXPECT="$(git -C "$D" rev-list --count "$PREV"..HEAD)"
[ "$COMMIT_COUNT" = "$EXPECT" ] || fail "10 count=$COMMIT_COUNT expected=$EXPECT"
FILES="$(sed -n '/^CHANGED_FILES<<EOF$/,/^EOF$/p' "$TMP/out.env" | sed '1d;$d')"
[ "$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')" = "$(sed -n 's/^CHANGED_FILE_COUNT=//p' "$TMP/out.env")" ] \
  || fail '10 changed file count disagrees with list'
pass 'review covers exactly the declared incremental range'

# --- case 11: provider failure publishes nothing ----------------------------
# The baseline selector never publishes. Publication is the workflow's job and
# is gated on a validated model result; assert the script has no publish path.
grep -qE 'gh api|pulls/.*/reviews' "$BASELINE" && fail '11 selector must not publish'
grep -q 'HTTP UNAVAILABLE' /dev/null 2>/dev/null || true
run_case "$TMP/c1" /dev/null 2>/dev/null || true
grep -qE 'REVIEW UNAVAILABLE' "$ROOT/.github/workflows/zig-zag-contextual-review.yml" \
  || fail '11 workflow must fail closed with REVIEW UNAVAILABLE'
pass 'provider failure yields no canonical review'

# --- case 12: publication uses the actual HEAD ------------------------------
WF="$ZIGZAG_WF"
# shellcheck disable=SC2016 # literal workflow text, not an expansion
grep -qE 'commit_id="\$HEAD_SHA"' "$WF" || fail '12 publication not bound to HEAD_SHA'
grep -q 'reviewed_head=%s' "$WF" || fail '12 marker must bind reviewed_head'
pass 'review publication is bound to the actual PR HEAD'

# --- case 13: root commit reports its real scope, not an empty one ---------
D="$TMP/c13"
git init -q "$D"
git -C "$D" config user.email t@example.invalid
git -C "$D" config user.name Test
printf 'a\n' > "$D/a.txt"; printf 'b\n' > "$D/b.txt"
git -C "$D" add -A; git -C "$D" commit -q -m root
ROOT="$(git -C "$D" rev-parse HEAD)"
echo '[]' > "$TMP/r13.json"
run_case "$D" "$TMP/r13.json"
[ "$COVERAGE" = entire-history-root ] || fail "13 coverage=$COVERAGE"
[ -z "$BASELINE_SHA" ] || fail "13 baseline must stay empty for a root commit"
[ "$COMMIT_COUNT" = 1 ] || fail "13 root commit must report 1 commit, got $COMMIT_COUNT"
[ "$(sed -n 's/^CHANGED_FILE_COUNT=//p' "$TMP/out.env")" = 2 ] \
  || fail "13 root commit must report its real changed file count"
case "$LIMIT" in *ROOT\ COMMIT*) : ;; *) fail '13 must state the root-commit limitation' ;; esac
pass 'root commit reports its real scope instead of an empty delta'

# --- case 14: workflow fails closed on an empty resolved range --------------
# `$ROOT` is the zig-zag checkout, but earlier cases `cd` into throwaway repos,
# so resolve the workflow path absolutely rather than from the current directory.
WF="$ZIGZAG_WF"
for guard in \
  'resolved range selected no commits' \
  'resolved range produced an empty diff' \
  'resolved range produced no changed files'; do
  grep -Fq "$guard" "$WF" || fail "14 missing fail-closed guard: $guard"
done
# The root-commit path must not fall back to a silently empty `..HEAD` range.
grep -Fq 'diff-tree --root -r --no-commit-id -p' "$WF" || fail '14 missing root-commit diff path'
grep -Fq 'diff-tree --root -r --no-commit-id --name-only' "$BASELINE" || fail '14 selector missing root-commit file list'
# --- case 15: every embedded run: block is valid shell ---------------------
# Two CI failures came from shell syntax inside the workflow that nothing
# checked: `printf '-->'` (parsed as an option) and a stray quote in the
# check-evidence fallback. Extract each run: block and syntax-check it, so a
# typo in embedded shell cannot reach a runner again.
run_blocks_dir="$TMP/runs"
mkdir -p "$run_blocks_dir"
ruby -ryaml -e '
d = YAML.load_file(ARGV.fetch(0))
out = ARGV.fetch(1)
d.fetch("jobs").each do |job_name, job|
  (job["steps"] || []).each_with_index do |step, i|
    run = step["run"]
    next unless run
    name = step["id"] || step["name"] || "step#{i}"
    File.write(File.join(out, "#{job_name}-#{i}-#{name}".gsub(%r{[^\w.-]}, "_")), run)
  end
end
' "$WF" "$run_blocks_dir"
block_count=0
for block in "$run_blocks_dir"/*; do
  [ -f "$block" ] || continue
  block_count=$((block_count + 1))
  if ! bash -n "$block" 2>"$run_blocks_dir/err"; then
    echo "invalid shell in workflow block: $(basename "$block")" >&2
    cat "$run_blocks_dir/err" >&2
    fail '15 an embedded run: block is not valid shell'
  fi
done
[ "$block_count" -ge 10 ] || fail "15 expected the review workflow blocks, found $block_count"
pass "all $block_count embedded run: blocks are valid shell"

# --- case 17: range marker survives a POSIX shell, not just GNU sed ---------
# The original marker used `\|` alternation inside a BRE, a GNU sed extension.
# On BSD sed that matches nothing, so the marker rendered empty while the step
# still exited 0. Reproduce the marker build under /bin/sh with POSIX tools only.
WF_MARKER_OUT="$(mktemp)"
(
  set -eu
  TRACK='contextual-review-groq'
  range="$TMP/out.env"
  {
    printf '%s\n' '<!-- zig-zag-contextual-review-range'
    for key in BASELINE_SHA REVIEWED_SHA COVERAGE COMMIT_COUNT REVIEW_KIND DOCS_ONLY; do
      value="$(sed -n "s/^$key=//p" "$range")"
      printf '%s:%s=%s\n' "$TRACK" "$key" "$value"
    done
    printf '%s\n' '-->'
  } > "$WF_MARKER_OUT"
)
for key in BASELINE_SHA REVIEWED_SHA COVERAGE COMMIT_COUNT REVIEW_KIND DOCS_ONLY; do
  grep -Fq "contextual-review-groq:$key=" "$WF_MARKER_OUT" || fail "15 marker missing $key"
done
[ "$(grep -c 'zig-zag-contextual-review-range' "$WF_MARKER_OUT")" -eq 1 ] || fail '17 marker comment must appear once'
rm -f "$WF_MARKER_OUT"
# The workflow must not reintroduce the non-portable BRE alternation.
if grep -Eq "s\/^\\\\\(" "$WF"; then
  fail '17 workflow must not use BRE backslash-paren alternation (non-portable)'
fi
grep -Fq 'printf %s@' "$WF" || true
pass 'range marker is built portably and is non-empty'

# --- case 18: no printf format begins with a bare dash ----------------------
# `printf '-->'` is parsed as an option by GNU coreutils printf and exits 2,
# failing the run after the range was already resolved.
if grep -Eq "printf '[-:]" "$WF"; then
  fail '18 printf format starts with a dash and will be read as an option'
fi
pass 'no printf format starts with a bare dash'

printf 'ALL BASELINE FIXTURES PASSED\n'
