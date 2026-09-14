# Preference-First Agent Execution Contract

This document is the concise execution contract for stateless coding-agent
tasks on the preference-first cutover. Architecture and domain invariants stay
in the canonical plans/specs; this file governs agent process only.

## Repository truth

- Canonical repository: `jiseruk/zig-zag`.
- Canonical remote: `fork` (`git@github.com:jiseruk/zig-zag.git`).
- Target branch: `feat/preference-first-selection`.
- Expected worktree: `ui-redesign`.
- Expected worktree path: `/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign`.
- `fork` is the only write target for this initiative.
- All fetch/push operations for `feat/preference-first-selection` use `fork`.
- `origin` is upstream and is out of scope for writes.
- Never create, update, or push `feat/preference-first-selection` to `origin`.
- Always run `git fetch fork`; the remote target branch is the source of truth.
- Any SHA in a task is informational. Never blindly reset to an old SHA.

## Worktree and repository-root semantics

Before reading repository instructions or task documents:

```bash
cd /Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote get-url fork
git remote get-url origin
```

`git rev-parse --show-toplevel` must resolve to:

`/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign`

Repository-root files are referenced relative to that root. Read `AGENTS.md`
from the worktree root. Do not interpret `/AGENTS.md` as an absolute filesystem
path in this workflow.

If the worktree, branch, or canonical `fork` remote does not match the expected
state, STOP and report it instead of silently switching repositories/worktrees.

## Stateless execution

Every task begins as:

`STATELESS TASK — READ THIS AS A NEW SESSION`

Assume no chat history, summaries, or memory. Derive state from the current
worktree, remote branch, canonical docs, implementation, and tests.

A task-specific implementation plan referenced by an execution prompt MUST
already exist on `fork/feat/preference-first-selection`. If it does not exist,
STOP. Do not reconstruct it from chat context or invent a replacement design.

## Safety and concurrency

- Inspect worktree, branch, and HEAD before work; stop on unrelated dirty changes.
- Never automatically reset, stash, discard, or overwrite unrelated changes.
- Re-fetch the remote before committing and again before the final report.
- Preserve concurrent changes; inspect and integrate remote advances safely.
- Never force-push or rewrite remote history during an ordinary milestone task.

## Canonical reading order

1. Repository-root `AGENTS.md`
2. CURRENT MAIN PROGRESS
3. Current milestone/task
4. Live-cutover plan
5. Implementation plan
6. Canonical design/spec
7. Actual implementation
8. Tests

## Verification semantics

Always distinguish `agent-executed`, `reviewer-verified`, and `not
independently verified`. An agent must not call its own implementation
approved. Its implementation status is:

`IMPLEMENTED — awaiting independent review`

## Progress discipline

When implementation changes project state, update CURRENT MAIN PROGRESS before
finishing. Record the starting remote HEAD, implementation commit, exact fresh
test results, blockers/deviations, and current next gate. Keep own status at
`awaiting independent review`.

## Stop discipline

Do not start the next milestone without explicit authorization. End the final
report at the requested checkpoint.
