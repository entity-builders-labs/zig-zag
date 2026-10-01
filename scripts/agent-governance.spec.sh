#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf 'PASS %s\n' "$1"; }
expect_ok() { "$@" >/dev/null; }
expect_fail() { if "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; }

SKILLS="$ROOT/.agents/skills"
for command in list status resume publish review; do
  skill="$SKILLS/zig-zag-track-$command/SKILL.md"
  [ -f "$skill" ] && [ ! -L "$skill" ]
  grep -qx "name: zig-zag-track-$command" "$skill"
done
[ ! -e "$SKILLS/resume-track/SKILL.md" ]
pass 'public commands are tracked Zig-Zag namespaced skills and generic resume is retired'

LIST_SKILL="$SKILLS/zig-zag-track-list/SKILL.md"
grep -Fq 'scripts/agent-track list' "$LIST_SKILL"
grep -Fq 'This command is read-only' "$LIST_SKILL"
pass 'LIST delegates to canonical discovery without durable state'

STATUS_SKILL="$SKILLS/zig-zag-track-status/SKILL.md"
for required in 'scripts/agent-track context' 'bash scripts/agent-preflight' \
  'This command creates no durable state' 'reviewed_head == current HEAD'; do
  grep -Fq "$required" "$STATUS_SKILL"
done
pass 'STATUS composes local facts and HEAD-anchored review without state'

RESUME_SKILL="$SKILLS/zig-zag-track-resume/SKILL.md"
for required in \
  'scripts/agent-track context' \
  'scripts/agent-track list' \
  'scripts/agent-track locate <exact-track-id>' \
  'bash scripts/agent-preflight' \
  'Worktree: <not registered>' \
  'If locate and context disagree, stop' \
  "On \`WRITE BLOCKED\`, stop" \
  'This command creates no durable track state'; do
  grep -Fq "$required" "$RESUME_SKILL"
done
for forbidden in 'git checkout' 'git switch' 'git reset' 'git rebase' \
  'git merge' 'git worktree add' 'git worktree remove' 'aliases=' \
  'displayName=' 'owns=' 'touches='; do
  if grep -Fq "$forbidden" "$RESUME_SKILL"; then
    echo "forbidden resume authority or mutation token: $forbidden" >&2
    exit 1
  fi
done
pass 'RESUME preserves locate and registered-worktree safety without mutation'

PUBLISH_SKILL="$SKILLS/zig-zag-track-publish/SKILL.md"
for required in \
  'STOP: no integration PR' \
  'STOP: ambiguous' \
  'equals the declared integration target' \
  'tracked or untracked files' \
  'git diff --check' \
  'shellcheck scripts/agent-track scripts/agent-preflight scripts/agent-governance.spec.sh' \
  'head repository and head branch' \
  'head SHA to equal the pushed HEAD' \
  'reviewed_head == current HEAD'; do
  grep -Fq "$required" "$PUBLISH_SKILL"
done
for forbidden in 'creates or merges a PR' 'rebases or merges' 'never creates or merges a PR'; do
  grep -Fq "$forbidden" "$PUBLISH_SKILL"
done
pass 'PUBLISH has deterministic PR, dirty-state, remote, and review guards without a real push'

REVIEW_SKILL="$SKILLS/zig-zag-track-review/SKILL.md"
for required in \
  '.github/codex/track-review-contract.md' \
  'Zig-Zag Contextual Review' \
  'workflow_dispatch' \
  'Never imitate the PR review' \
  'This command never edits repository contents'; do
  grep -Fqi "$required" "$REVIEW_SKILL"
done
pass 'REVIEW is namespaced and delegates retry to the canonical workflow'

REVIEW_WORKFLOW="$ROOT/.github/workflows/zig-zag-contextual-review.yml"
REVIEW_PROMPT="$ROOT/.github/codex/track-review-prompt.md"
REVIEW_SCHEMA="$ROOT/.github/codex/track-review-schema.json"
REVIEW_CONTRACT="$ROOT/.github/codex/track-review-contract.md"
test -f "$REVIEW_WORKFLOW" && test -f "$REVIEW_PROMPT" && \
  test -f "$REVIEW_SCHEMA" && test -f "$REVIEW_CONTRACT"
ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0))' "$REVIEW_WORKFLOW" >/dev/null
jq -e '.type == "object" and (.required | index("reviewed_head")) and (.properties.findings.type == "array")' "$REVIEW_SCHEMA" >/dev/null
grep -Fq 'types: [opened, reopened, synchronize]' "$REVIEW_WORKFLOW"
grep -Fq 'workflow_dispatch:' "$REVIEW_WORKFLOW"
if grep -Fq 'pull_request_target' "$REVIEW_WORKFLOW"; then
  echo 'contextual review must not use pull_request_target' >&2
  exit 1
fi
grep -Fq 'group: zig-zag-contextual-review-' "$REVIEW_WORKFLOW"
grep -Fq 'cancel-in-progress: true' "$REVIEW_WORKFLOW"
pass 'contextual workflow triggers on draft-eligible PR updates and supports retry'

for required in \
  'checks: read' \
  'contents: read' \
  'pull-requests: write' \
  'permission-profile: :read-only' \
  'without persisted credentials' \
  'head_repo != github.repository' \
  'No OPENAI_API_KEY is exposed to untrusted fork code.'; do
  grep -Fq "$required" "$REVIEW_WORKFLOW"
done
for forbidden in 'contents: write' 'actions: write' 'issues: write' 'pull_request_target'; do
  if grep -Fq "$forbidden" "$REVIEW_WORKFLOW"; then
    echo "forbidden workflow permission or trigger: $forbidden" >&2
    exit 1
  fi
done
pass 'contextual workflow has read-only Codex and fork-secret trust boundary'

grep -Fq 'openai/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e' "$REVIEW_WORKFLOW"
grep -Fq '# openai/codex-action v1' "$REVIEW_WORKFLOW"
# shellcheck disable=SC2016 # These are literal workflow expressions/snippets.
grep -Fq 'test "$(git rev-parse HEAD)" = "$HEAD_SHA"' "$REVIEW_WORKFLOW"
# shellcheck disable=SC2016 # These are literal workflow expressions/snippets.
grep -Fq 'git merge-base HEAD "origin/$BASE_REF"' "$REVIEW_WORKFLOW"
grep -Fq 'integration_diff=git diff --find-renames --find-copies' "$REVIEW_WORKFLOW"
grep -Fq "git fetch --no-tags origin '+refs/heads/*:refs/remotes/origin/*'" "$REVIEW_WORKFLOW"
pass 'review is pinned, exact-HEAD anchored, and uses merge-base semantics'

for required in \
  'scripts/agent-track context' \
  'AGENTS.md' \
  'bash scripts/agent-preflight' \
  'track-review-schema.json' \
  'track-review-input.md' \
  'PR metadata' \
  'check-evidence snapshot' \
  'code_review_verdict' \
  'architecture_verdict' \
  'reviewed_head'; do
  grep -Fq "$required" "$REVIEW_PROMPT"
done
grep -Fq '<!-- zig-zag-contextual-review' "$REVIEW_CONTRACT"
grep -Fq 'reviewed_head == current PR HEAD' "$REVIEW_CONTRACT"
if rg -q 'reviewStatus=|reviewedHead=|reviewVerdict=' docs/superpowers/progress; then
  echo 'review status must not be persisted in progress metadata' >&2
  exit 1
fi
pass 'canonical context, structured output, marker, and stale semantics are explicit'

for required in \
  'configure repository secret OPENAI_API_KEY' \
  'Validate structured review output' \
  'gh pr review' \
  'Avoid duplicate review for the same head'; do
  grep -Fq "$required" "$REVIEW_WORKFLOW"
done
for forbidden in 'git commit' 'git push' 'gh pr merge' 'git merge ' 'git rebase'; do
  if grep -Fq "$forbidden" "$REVIEW_WORKFLOW"; then
    echo "forbidden autonomous mutation: $forbidden" >&2
    exit 1
  fi
done
pass 'review failures cannot become PASS and no autonomous mutation loop exists'

grep -Fq 'track-review-contract.md' "$STATUS_SKILL"
grep -Fq 'track-review-contract.md' "$RESUME_SKILL"
pass 'STATUS and RESUME share the contextual review artifact contract'

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
mkdir -p "$TMP/docs/superpowers/progress"
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

expect_ok bash -c "cd '$TMP' && GITHUB_HEAD_REF=feat/current GITHUB_BASE_REF=main bash scripts/agent-preflight --ci --no-fetch | grep -q 'INTEGRATION READY'"
pass 'clean merge-tree reports integration readiness'

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
mkdir -p "$TMP/docs/superpowers/progress"
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
git -C "$TMP" branch -f feat/current "$BASE"
git -C "$TMP" checkout -q feat/current
mkdir -p "$TMP/docs/superpowers/progress"
printf '%s\n' \
  '# Current' \
  "<!-- agent-track: id=current; status=ACTIVE; branch=feat/current; integration=main; base=$BASE; plan=docs/superpowers/plans/current.md -->" \
  >"$TMP/docs/superpowers/progress/current.md"
printf 'parent before child\n' >"$TMP/shared.txt"
git -C "$TMP" add docs shared.txt && git -C "$TMP" commit -qm parent-before-child
PARENT_BEFORE_CHILD="$(git -C "$TMP" rev-parse HEAD)"
git -C "$TMP" checkout -q -B feat/other "$PARENT_BEFORE_CHILD"
printf '%s\n' \
  '# Other' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/other; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP/docs/superpowers/progress/other.md"
printf 'child after divergence\n' >"$TMP/shared.txt"
git -C "$TMP" add docs shared.txt && git -C "$TMP" commit -qm child-after-divergence
git -C "$TMP" update-ref refs/remotes/origin/feat/other HEAD
git -C "$TMP" checkout -q feat/current
git -C "$TMP" update-ref refs/remotes/origin/feat/current HEAD
expect_ok bash -c "cd '$TMP' && ! bash scripts/agent-preflight --no-fetch | grep -q 'file overlap: other'"
pass 'parent changes inherited before child divergence do not produce overlap'

printf 'parent after divergence\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm parent-after-divergence
git -C "$TMP" update-ref refs/remotes/origin/feat/current HEAD
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap: other.*shared.txt'"
pass 'parent and child changes after divergence produce overlap'

git -C "$TMP" checkout -q main
printf 'main conflict\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm conflict
git -C "$TMP" update-ref refs/remotes/origin/main HEAD
git -C "$TMP" checkout -q feat/current
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'WRITE AUTHORIZED'"
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'INTEGRATION BLOCKED'"
expect_ok bash -c "cd '$TMP' && ! bash scripts/agent-preflight --no-fetch | grep -q 'INTEGRATION READY'"
pass 'local integration conflict blocks merging but authorizes isolated writes'

expect_fail bash -c "cd '$TMP' && GITHUB_HEAD_REF=feat/current GITHUB_BASE_REF=main bash scripts/agent-preflight --ci --no-fetch"
pass 'CI integration conflict remains a hard failure'

INVALID_BASE="$(git -C "$TMP" rev-parse feat/other)"
sed -i.bak "s/base=$BASE/base=$INVALID_BASE/" "$TMP/docs/superpowers/progress/current.md"
expect_fail bash -c "cd '$TMP' && bash scripts/agent-preflight --allow-dirty --no-fetch"
mv "$TMP/docs/superpowers/progress/current.md.bak" "$TMP/docs/superpowers/progress/current.md"
pass 'invalid base ancestry remains a local hard failure'

expect_ok bash -c "cd '$TMP' && ! rg -q \"ow\"\"ns=|tou\"\"ches=\" docs/superpowers/progress"
pass 'track headers need no manual ownership tokens'

expect_ok bash -c "cd '$TMP' && scripts/agent-track list | grep -q 'feat/current'"
expect_ok bash -c "cd '$TMP' && scripts/agent-track list | grep -q 'feat/other'"
pass 'agent-track list reports active tracks across refs'

expect_ok bash -c "cd '$TMP' && scripts/agent-track context | grep -q 'Progress: docs/superpowers/progress/current.md'"
pass 'agent-track context reports progress, plan, and current branch'

HEAD_BEFORE="$(git -C "$TMP" rev-parse HEAD)"
BRANCH_BEFORE="$(git -C "$TMP" branch --show-current)"
STATUS_BEFORE="$(git -C "$TMP" status --porcelain)"
INDEX_BEFORE="$(git -C "$TMP" diff --cached --binary)"
WORKTREES_BEFORE="$(git -C "$TMP" worktree list --porcelain)"
CURRENT_WORKTREE="$(printf '%s\n' "$WORKTREES_BEFORE" | sed -n 's/^worktree //p' | sed -n '1p')"
LOCATE_CURRENT="$(cd "$TMP" && scripts/agent-track locate current)"
LOCATE_OTHER="$(cd "$TMP" && scripts/agent-track locate other)"
[ "$HEAD_BEFORE" = "$(git -C "$TMP" rev-parse HEAD)" ]
[ "$BRANCH_BEFORE" = "$(git -C "$TMP" branch --show-current)" ]
[ "$STATUS_BEFORE" = "$(git -C "$TMP" status --porcelain)" ]
[ "$INDEX_BEFORE" = "$(git -C "$TMP" diff --cached --binary)" ]
[ "$WORKTREES_BEFORE" = "$(git -C "$TMP" worktree list --porcelain)" ]
printf '%s\n' "$LOCATE_CURRENT" | grep -q "Worktree: $CURRENT_WORKTREE"
pass 'locate finds the current ACTIVE track without mutating Git state'

test ! -e "$TMP/docs/superpowers/progress/other.md"
printf '%s\n' "$LOCATE_OTHER" | grep -q 'Track: other'
printf '%s\n' "$LOCATE_OTHER" | grep -q 'Worktree: <not registered>'
pass 'locate finds a remote-only peer without creating a worktree'

expect_fail bash -c "cd '$TMP' && scripts/agent-track locate unknown"
UNKNOWN_OUTPUT="$(cd "$TMP" && scripts/agent-track locate unknown 2>&1 || true)"
printf '%s\n' "$UNKNOWN_OUTPUT" | grep -q 'TRACK LOCATION UNAVAILABLE'
pass 'unknown track ID fails explicitly'

TMP_PEER="$TMP.peer"
git -C "$TMP" worktree add -q "$TMP_PEER" feat/other
TMP_PEER_REAL="$(cd "$TMP_PEER" && pwd -P)"
LOCATE_REGISTERED="$(cd "$TMP" && scripts/agent-track locate other)"
printf '%s\n' "$LOCATE_REGISTERED" | grep -q "Worktree: $TMP_PEER_REAL"
[ "$(printf '%s\n' "$LOCATE_REGISTERED" | grep -c '^Track: other$')" -eq 1 ]
pass 'locate reports a registered peer once across worktree and origin discovery'

TMP_DUPLICATE="$TMP.duplicate"
git -C "$TMP" worktree add -q -b feat/duplicate "$TMP_DUPLICATE" "$BASE"
mkdir -p "$TMP_DUPLICATE/docs/superpowers/progress"
printf '%s\n' \
  '# Duplicate' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/duplicate; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP_DUPLICATE/docs/superpowers/progress/duplicate.md"
git -C "$TMP_DUPLICATE" add docs && git -C "$TMP_DUPLICATE" commit -qm duplicate
git -C "$TMP" update-ref refs/remotes/origin/feat/duplicate "$(git -C "$TMP_DUPLICATE" rev-parse HEAD)"
expect_fail bash -c "cd '$TMP' && scripts/agent-track locate other"
AMBIGUOUS_OUTPUT="$(cd "$TMP" && scripts/agent-track locate other 2>&1 || true)"
printf '%s\n' "$AMBIGUOUS_OUTPUT" | grep -q 'TRACK LOCATION AMBIGUOUS'
pass 'duplicate ACTIVE track IDs across branches fail as ambiguous'

git -C "$TMP" worktree remove --force "$TMP_DUPLICATE"
git -C "$TMP" worktree remove --force "$TMP_PEER"
