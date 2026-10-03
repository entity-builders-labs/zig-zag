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
  'shellcheck scripts/agent-track scripts/agent-preflight scripts/agent-progress-gate scripts/agent-governance.spec.sh' \
  'bash scripts/agent-progress-gate' \
  'STOP publication' \
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
jq -e '.properties.findings.items.properties as $props | .properties.findings.items.required as $req | ($props | keys | sort) == ($req | sort)' "$REVIEW_SCHEMA" >/dev/null
pass 'every finding property is required for Structured Outputs compatibility'
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
  'No GROQ_API_KEY is exposed to untrusted fork code.'; do
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
  'REVIEW_INPUT_FILE' \
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
  'configure repository secret GROQ_API_KEY' \
  'Validate structured review output' \
  'gh api' \
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

expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap'"
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
expect_ok bash -c "cd '$TMP' && ! bash scripts/agent-preflight --no-fetch | grep -q 'file overlap'"
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
expect_ok bash -c "cd '$TMP' && ! bash scripts/agent-preflight --no-fetch | grep -q 'file overlap'"
pass 'parent changes inherited before child divergence do not produce overlap'

printf 'parent after divergence\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm parent-after-divergence
git -C "$TMP" update-ref refs/remotes/origin/feat/current HEAD
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap.*shared.txt'"
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
UNKNOWN_OUTPUT="$(cd "$TMP" && scripts/agent-track locate unknown 2>&1)" || true
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
AMBIGUOUS_OUTPUT="$(cd "$TMP" && scripts/agent-track locate other 2>&1)" || true
printf '%s\n' "$AMBIGUOUS_OUTPUT" | grep -q 'TRACK LOCATION AMBIGUOUS'
pass 'duplicate ACTIVE track IDs across branches fail as ambiguous'

git -C "$TMP" worktree remove --force "$TMP_DUPLICATE"
git -C "$TMP" worktree remove --force "$TMP_PEER"

# Two distinct ACTIVE declarations on the same branch must be ambiguous
TMP_SAME_BRANCH="$TMP.same-branch"
git -C "$TMP" worktree add -q "$TMP_SAME_BRANCH" feat/other
mkdir -p "$TMP_SAME_BRANCH/docs/superpowers/progress"
printf '%s\n' \
  '# Other' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/other; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP_SAME_BRANCH/docs/superpowers/progress/other.md"
printf '%s\n' \
  '# Other2' \
  "<!-- agent-track: id=other2; status=ACTIVE; branch=feat/other; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP_SAME_BRANCH/docs/superpowers/progress/other2.md"
git -C "$TMP_SAME_BRANCH" add docs && git -C "$TMP_SAME_BRANCH" commit -qm same-branch
git -C "$TMP" update-ref refs/remotes/origin/feat/other "$(git -C "$TMP_SAME_BRANCH" rev-parse HEAD)"
expect_fail bash -c "cd '$TMP' && scripts/agent-track locate other"
AMBIGUOUS_SAME_BRANCH_OUTPUT="$(cd "$TMP" && scripts/agent-track locate other 2>&1)" || true
printf '%s\n' "$AMBIGUOUS_SAME_BRANCH_OUTPUT" | grep -q 'TRACK LOCATION AMBIGUOUS'
pass 'two distinct ACTIVE declarations on one branch fail as ambiguous'

git -C "$TMP" worktree remove --force "$TMP_SAME_BRANCH"

# --- Stale local peer ref coverage ---

# Local feat/peer is stale; origin/feat/peer has the overlapping change
git -C "$TMP" checkout -q main
git -C "$TMP" branch -f feat/peer "$BASE"
git -C "$TMP" checkout -q feat/peer
mkdir -p "$TMP/docs/superpowers/progress"
printf '%s\n' \
  '# Other' \
  "<!-- agent-track: id=other; status=ACTIVE; branch=feat/peer; integration=main; base=$BASE; plan=docs/superpowers/plans/other.md -->" \
  >"$TMP/docs/superpowers/progress/other.md"
printf 'stale\n' >"$TMP/shared.txt"
git -C "$TMP" add docs shared.txt && git -C "$TMP" commit -qm stale-peer
git -C "$TMP" checkout -q feat/current
printf 'overlap-current\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm current-change
# Advance origin/feat/peer with the overlapping change
git -C "$TMP" checkout -q feat/peer
printf 'overlap-remote\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm remote-peer-change
git -C "$TMP" update-ref refs/remotes/origin/feat/peer "$(git -C "$TMP" rev-parse HEAD)"
git -C "$TMP" checkout -q feat/current
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap.*shared.txt'"
pass 'stale local peer does not hide fetched remote overlap'

# --- Registered stale peer + newer remote overlap coverage ---

# Clean up any existing worktrees (skip main — always first)
git -C "$TMP" worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //' | tail -n +2 | while IFS= read -r wt; do
  git -C "$TMP" worktree remove --force "$wt" 2>/dev/null || true
done
git -C "$TMP" checkout -q main
git -C "$TMP" branch -f feat/peer "$BASE" 2>/dev/null || true
# Create the stale-peer commit on a detached HEAD so feat/peer is not checked out
git -C "$TMP" checkout -q --detach "$BASE"
mkdir -p "$TMP/docs/superpowers/progress"
printf '%s\n' \
  '# Peer' \
  "<!-- agent-track: id=peer; status=ACTIVE; branch=feat/peer; integration=main; base=$BASE; plan=docs/superpowers/plans/peer.md -->" \
  >"$TMP/docs/superpowers/progress/peer.md"
# Registered peer does NOT change shared.txt; it only adds its progress doc
git -C "$TMP" add docs && git -C "$TMP" commit -qm stale-peer
git -C "$TMP" branch -f feat/peer HEAD
PEER_LOCAL_SHA="$(git -C "$TMP" rev-parse HEAD)"
# Register a worktree for feat/peer at the stale local SHA
TMP_REGISTERED="$TMP.registered"
git -C "$TMP" worktree add -q "$TMP_REGISTERED" feat/peer
# Advance origin/feat/peer with the overlapping change WITHOUT moving local feat/peer
git -C "$TMP" checkout -q --detach feat/peer
printf 'overlap-remote\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm remote-peer-change
PEER_REMOTE_SHA="$(git -C "$TMP" rev-parse HEAD)"
git -C "$TMP" update-ref refs/remotes/origin/feat/peer "$PEER_REMOTE_SHA"
git -C "$TMP" checkout -q feat/current
# Current track independently changes shared.txt on its own side
printf 'overlap-current-registered\n' >"$TMP/shared.txt"
git -C "$TMP" add shared.txt && git -C "$TMP" commit -qm current-change
# Assert registered local peer SHA is unchanged while origin peer advances
[ "$(git -C "$TMP" rev-parse feat/peer)" = "$PEER_LOCAL_SHA" ]
[ "$(git -C "$TMP" rev-parse origin/feat/peer)" != "$PEER_LOCAL_SHA" ]
pass 'registered local peer SHA is unchanged while origin peer advances'
expect_ok bash -c "cd '$TMP' && bash scripts/agent-preflight --no-fetch | grep -q 'file overlap.*shared.txt'"
pass 'registered stale peer does not hide fetched remote overlap'
# list/locate still show one logical peer identity
expect_ok bash -c "cd '$TMP' && scripts/agent-track list | grep -cE '^peer[[:space:]]' | grep -qx '1'"
pass 'list shows one logical peer identity despite distinct refs'
LOCATE_REGISTERED="$(cd "$TMP" && scripts/agent-track locate peer)"
[ "$(printf '%s\n' "$LOCATE_REGISTERED" | grep -c '^Track: peer$')" -eq 1 ]
printf '%s\n' "$LOCATE_REGISTERED" | grep -q "Worktree: $(cd "$TMP_REGISTERED" && pwd -P)"
pass 'locate shows one logical peer identity despite distinct refs'
git -C "$TMP" worktree remove --force "$TMP_REGISTERED"

# --- Review commit binding coverage ---

# One shared authenticity filter implements the canonical rules in
# .github/codex/track-review-contract.md: publisher author, eligible state,
# exact marker, commit_id equal to the marked reviewed_head, and both verdict
# fields. Only the review data varies between assertions.
canonical_review_count() {
  jq '[ .[]
    | . as $review
    | (try ($review.body | capture("zig-zag-contextual-review\\ntrack=(?<track>[^\\n]+)\\nreviewed_head=(?<reviewed_head>[^\\n]+)\\n-->")) catch null) as $marker
    | select(
        $marker != null and
        ($review.user.login == "github-actions[bot]") and
        (["COMMENTED", "APPROVED", "CHANGES_REQUESTED"] | index($review.state)) != null and
        ($review.commit_id == $marker.reviewed_head) and
        ($marker.track == "t") and
        ($review.body | contains("CODE REVIEW:")) and
        ($review.body | contains("ARCHITECTURE_"))
      )
  ] | length'
}

# commit_id <markered reviewed_head> → the review is bound to another commit
review_fixture() {
  jq -n --arg author "${3:-github-actions[bot]}" --arg commit_id "$1" \
    --arg reviewed_head "$2" \
    --arg architecture "${4:-ARCHITECTURE_: PASS}" '[{
      user: {login: $author},
      state: "COMMENTED",
      commit_id: $commit_id,
      body: ("<!-- zig-zag-contextual-review\ntrack=t\nreviewed_head=" + $reviewed_head + "\n-->\nCODE REVIEW: PASS\n" + $architecture)
    }]'
}

[ "$(review_fixture oldsha newsha | canonical_review_count)" = 0 ]
pass 'mismatched commit_id is not canonical'

[ "$(review_fixture newsha newsha | canonical_review_count)" = 1 ]
pass 'matching commit_id is canonical'

[ "$(review_fixture newsha newsha impostor | canonical_review_count)" = 0 ]
pass 'a copied marker from another author is not canonical'

[ "$(review_fixture newsha newsha github-actions[bot] 'no verdict fields' | canonical_review_count)" = 0 ]
pass 'a review without both verdict fields is not canonical'

# --- Context ID assertion coverage ---

# Foreign ID must fail
expect_fail bash -c "cd '$TMP' && scripts/agent-track context other"
pass 'foreign ID fails context'

# Inactive ID must fail
git -C "$TMP" checkout -q feat/other
sed -i.bak 's/status=ACTIVE/status=INACTIVE/' "$TMP/docs/superpowers/progress/other.md"
git -C "$TMP" add docs && git -C "$TMP" commit -qm deactivate
git -C "$TMP" checkout -q feat/current
expect_fail bash -c "cd '$TMP' && scripts/agent-track context other"
pass 'inactive ID fails context'
# Restore
git -C "$TMP" checkout -q feat/other
git -C "$TMP" revert --no-edit HEAD
git -C "$TMP" checkout -q feat/current

# Detached HEAD + GITHUB_HEAD_REF must work
git -C "$TMP" checkout -q --detach feat/current
expect_ok bash -c "cd '$TMP' && GITHUB_HEAD_REF=feat/current scripts/agent-track context current | grep -q 'Track: current'"
pass 'detached HEAD with GITHUB_HEAD_REF resolves context'
git -C "$TMP" checkout -q feat/current

# --- Progress gate coverage ---

PROGRESS_GATE="$ROOT/scripts/agent-progress-gate"
test -f "$PROGRESS_GATE" && [ -x "$PROGRESS_GATE" ]
pass 'progress gate script exists and is executable'

# Implementation without progress update → FAIL
TMP_GATE="$TMP.gate"
git -C "$TMP" worktree add -q -b feat/gate "$TMP_GATE" feat/current
printf '%s\n' \
  '# Current' \
  "<!-- agent-track: id=current; status=ACTIVE; branch=feat/gate; integration=main; base=$BASE; plan=docs/superpowers/plans/current.md -->" \
  '## Current execution verdict' \
  '**Milestone 2B — COMPLETE.**' \
  '## Current checkpoint' \
  'Resume contract checkpoint.' \
  '## Next authorized action' \
  'Implement the bounded resume-state change.' \
  '## Open findings / blockers' \
  '- GOV-1: preserve track isolation.' \
  >"$TMP_GATE/docs/superpowers/progress/current.md"
git -C "$TMP_GATE" add docs && git -C "$TMP_GATE" commit -qm "update branch"
printf 'impl\n' >"$TMP_GATE/impl.txt"
git -C "$TMP_GATE" add impl.txt && git -C "$TMP_GATE" commit -qm impl
expect_fail bash -c "cd '$TMP_GATE' && bash '$PROGRESS_GATE' --no-fetch"
pass 'implementation without progress update fails progress gate'

# Implementation then progress → PASS
printf 'progress\n' >>"$TMP_GATE/docs/superpowers/progress/current.md"
git -C "$TMP_GATE" add docs && git -C "$TMP_GATE" commit -qm progress
expect_ok bash -c "cd '$TMP_GATE' && bash '$PROGRESS_GATE' --no-fetch"
pass 'implementation then progress passes progress gate'

# Implementation + progress in final commit → PASS
printf 'more\n' >>"$TMP_GATE/impl.txt"
printf 'more\n' >>"$TMP_GATE/docs/superpowers/progress/current.md"
git -C "$TMP_GATE" add . && git -C "$TMP_GATE" commit -qm combined
expect_ok bash -c "cd '$TMP_GATE' && bash '$PROGRESS_GATE' --no-fetch"
pass 'implementation and progress in same commit passes progress gate'

# Progress then later implementation-only change → FAIL
printf 'stale\n' >>"$TMP_GATE/impl.txt"
git -C "$TMP_GATE" add impl.txt && git -C "$TMP_GATE" commit -qm stale
expect_fail bash -c "cd '$TMP_GATE' && bash '$PROGRESS_GATE' --no-fetch"
pass 'progress then later implementation-only change fails progress gate'

git -C "$TMP" worktree remove --force "$TMP_GATE"

# --- Contextual review authenticity coverage ---

# Foreign/copied review marker → not canonical
expect_ok bash -c "jq -e '
  [.[] | select(
    .user.login == \"evil-bot\" and
    (.body | contains(\"<!-- zig-zag-contextual-review\")) and
    (.body | contains(\"CODE REVIEW:\"))
  )] | length == 1
' <<<'[{\"user\":{\"login\":\"evil-bot\"},\"state\":\"COMMENTED\",\"body\":\"<!-- zig-zag-contextual-review\\ntrack=t\\nreviewed_head=a\\n-->\\nCODE REVIEW: PASS\"}]'"
pass 'foreign review marker is not canonical'

# Canonical publisher + valid artifact → canonical
expect_ok bash -c "jq -e '
  [.[] | select(
    .user.login == \"github-actions[bot]\" and
    (.state == \"COMMENTED\" or .state == \"APPROVED\" or .state == \"CHANGES_REQUESTED\") and
    (.body | contains(\"<!-- zig-zag-contextual-review\\ntrack=t\\nreviewed_head=a\\n-->\")) and
    (.body | contains(\"CODE REVIEW:\")) and
    (.body | contains(\"ARCHITECTURE_\"))
  )] | length == 1
' <<<'[{\"user\":{\"login\":\"github-actions[bot]\"},\"state\":\"COMMENTED\",\"body\":\"<!-- zig-zag-contextual-review\\ntrack=t\\nreviewed_head=a\\n-->\\nCODE REVIEW: PASS\\nARCHITECTURE_PASS\"}]'"
pass 'canonical publisher with valid artifact is canonical'

# Published review request → commit_id == reviewed HEAD → event == COMMENT
expect_ok bash -c "jq -e '
  .commit_id == \"abc123\" and .event == \"COMMENT\"
' <<<'{\"commit_id\":\"abc123\",\"event\":\"COMMENT\"}'"
pass 'published review request binds commit_id and event'

# Workflow uses commit_id binding for review publication
# shellcheck disable=SC2016 # These are literal workflow expressions.
grep -Fq 'commit_id="$HEAD_SHA"' "$REVIEW_WORKFLOW"
grep -Fq 'event="COMMENT"' "$REVIEW_WORKFLOW"
pass 'workflow publishes review with commit_id binding'
