#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf 'PASS %s\n' "$1"; }
expect_ok() { "$@" >/dev/null; }
expect_fail() { if "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; }

git -C "$TMP" init -q -b main
git -C "$TMP" config user.email governance@example.test
git -C "$TMP" config user.name Governance
mkdir -p "$TMP/scripts" "$TMP/docs/superpowers/progress" "$TMP/docs/superpowers/plans"
cp "$ROOT/scripts/agent-track" "$ROOT/scripts/agent-preflight" "$TMP/scripts/"
chmod +x "$TMP/scripts/agent-track" "$TMP/scripts/agent-preflight"
printf 'base\n' >"$TMP/shared.txt"
printf 'base\n' >"$TMP/other.txt"
printf '# Plan\n' >"$TMP/docs/superpowers/plans/current.md"
printf '# Plan\n' >"$TMP/docs/superpowers/plans/other.md"
git -C "$TMP" add . && git -C "$TMP" commit -qm base
BASE="$(git -C "$TMP" rev-parse HEAD)"

git -C "$TMP" checkout -qb feat/current
printf '%s\n' \
  '# Current' \
  "<!-- agent-track: id=current; status=ACTIVE; branch=feat/current; integration=main; base=$BASE; plan=docs/superpowers/plans/current.md -->" \
  '## Current execution verdict' \
  '**Milestone 2B — COMPLETE.**' \
  '## Current checkpoint' \
  'Resume contract checkpoint.' \
  '## Next authorized action' \
  'Implement the bounded resume-state change.' \
  '## Open findings / blockers' \
  '- GOV-1: preserve track isolation.' \
  >"$TMP/docs/superpowers/progress/current.md"
printf 'current\n' >"$TMP/shared.txt"
git -C "$TMP" add docs shared.txt && git -C "$TMP" commit -qm current
CURRENT="$(git -C "$TMP" rev-parse HEAD)"

git -C "$TMP" checkout -qb feat/other "$BASE"
printf '%s\n' \
  '# Other' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/other; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP/docs/superpowers/progress/other.md"
printf 'other\n' >"$TMP/shared.txt"
git -C "$TMP" add docs shared.txt && git -C "$TMP" commit -qm other
OTHER="$(git -C "$TMP" rev-parse HEAD)"

git -C "$TMP" checkout -q feat/current
git -C "$TMP" remote add origin git@github.com:entity-builders-labs/zig-zag.git
git -C "$TMP" update-ref refs/remotes/origin/main "$BASE"
git -C "$TMP" update-ref refs/remotes/origin/feat/current "$CURRENT"
git -C "$TMP" update-ref refs/remotes/origin/feat/other "$OTHER"

expect_ok bash -c "cd '$TMP' && scripts/agent-track context | grep -q 'Track: current'"
pass 'current branch resolves exactly one active track and context reports it'

expect_ok bash -c "cd '$TMP' && scripts/agent-track context | grep -q 'Implement the bounded resume-state change.'"
expect_ok bash -c "cd '$TMP' && scripts/agent-track context | grep -q 'GOV-1: preserve track isolation.'"
pass 'agent-track context exposes next authorized action and open findings'

expect_ok bash -c "cd '$TMP' && test ! -e docs/superpowers/progress/other.md && scripts/agent-track list | grep -q 'feat/other'"
pass 'peer track is discovered from its own remote branch without copied progress state'

expect_fail bash -c "cd '$TMP' && git checkout -q -b feat/missing && bash scripts/agent-preflight --no-fetch"
git -C "$TMP" checkout -q feat/current
pass 'missing track fails before write'

sed -i.bak 's/status=ACTIVE; branch=feat\/current/status=INACTIVE; branch=feat\/current/' "$TMP/docs/superpowers/progress/current.md"
expect_fail bash -c "cd '$TMP' && bash scripts/agent-preflight --allow-dirty --no-fetch"
mv "$TMP/docs/superpowers/progress/current.md.bak" "$TMP/docs/superpowers/progress/current.md"
pass 'inactive track is not write-authorized'

expect_ok bash -c "cd '$TMP' && GITHUB_HEAD_REF=feat/current GITHUB_BASE_REF=main bash scripts/agent-preflight --ci --no-fetch"
pass 'correct integration target passes'

expect_fail bash -c "cd '$TMP' && GITHUB_HEAD_REF=feat/current GITHUB_BASE_REF=wrong bash scripts/agent-preflight --ci --no-fetch"
pass 'wrong PR target fails'

printf 'dirty\n' >>"$TMP/other.txt"
expect_fail bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch"
git -C "$TMP" checkout -- other.txt
pass 'dirty worktree fails unless explicitly allowed'

expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap: other'"
pass 'same changed file on a branch-local peer produces warning'

git -C "$TMP" checkout -q main
git -C "$TMP" branch -f feat/other "$BASE"
git -C "$TMP" checkout -q feat/other
printf '%s\n' \
  '# Other' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/other; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP/docs/superpowers/progress/other.md"
printf 'unrelated\n' >"$TMP/other.txt"
git -C "$TMP" add docs other.txt && git -C "$TMP" commit -qm unrelated
git -C "$TMP" update-ref refs/remotes/origin/feat/other HEAD
git -C "$TMP" checkout -q feat/current
expect_ok bash -c "cd '$TMP' && ! bash scripts/agent-preflight --no-fetch | grep -q 'file overlap: other'"
pass 'unrelated branch changes do not produce overlap'

git -C "$TMP" checkout -q main
printf 'main conflict\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm conflict
git -C "$TMP" update-ref refs/remotes/origin/main HEAD
git -C "$TMP" checkout -q feat/current
expect_fail bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch"
pass 'integration merge conflict remains hard failure'

expect_ok bash -c "cd '$TMP' && ! rg -q \"ow\"\"ns=|tou\"\"ches=\" docs/superpowers/progress"
pass 'track headers need no manual ownership tokens'

expect_ok bash -c "cd '$TMP' && scripts/agent-track list | grep -q 'feat/current'"
expect_ok bash -c "cd '$TMP' && scripts/agent-track list | grep -q 'feat/other'"
pass 'agent-track list reports active tracks across refs'

expect_ok bash -c "cd '$TMP' && scripts/agent-track context | grep -q 'Progress: docs/superpowers/progress/current.md'"
pass 'agent-track context reports progress, plan, and current branch'
