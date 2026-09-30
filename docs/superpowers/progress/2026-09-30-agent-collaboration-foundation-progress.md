# Agent Collaboration Foundation — Progress

<!-- agent-track: id=agent-collaboration-foundation; status=ACTIVE; branch=chore/agent-collaboration-foundation; integration=feat/preference-first-selection; base=74a545f2f4b1f724fe4cfa6f23c804b281b90f02; plan=docs/superpowers/plans/2026-09-30-agent-collaboration-foundation-plan.md -->

## Current execution verdict

**Milestone 2B — ACCEPTED ON GOVERNANCE BRANCH / NOT YET INTEGRATED.**

The former initiative registry and manual semantic-ownership model have been
replaced by progress-owned track identity, actual branch-diff overlap warnings,
and checkout-local track context. The originally scoped implementation and
deterministic verification are complete.

Architecture review found one foundation-level discovery gap: peer-track
discovery was scoped to progress files visible in the current checkout, so a
sibling track whose progress file existed only on its own branch/worktree could
be invisible from the other track.

The bounded fix preserves current-track authority in the current checkout while
peer discovery derives ACTIVE track identity from registered worktrees plus
fetched `origin/*` branch refs, filtered by each track's own declared `branch=`.
No central registry or manual scope tokens were added.

Acceptance verification passed:

```text
shellcheck scripts/agent-track scripts/agent-preflight scripts/agent-governance.spec.sh
PASS

bash scripts/agent-governance.spec.sh
PASS — 14 cases, including branch-local peer discovery and real same-file overlap

git diff --check
PASS
```

GOV-GATE-1 verification passed with 16 governance cases. Local preflight now
returns WRITE AUTHORIZED plus INTEGRATION BLOCKED for the intentionally
unresolved moving-target conflict; the same conflict remains a CI hard failure.

GOV-LOCATE-1 verification passed with 21 governance cases. `agent-track locate`
uses registered-worktree plus fetched-ref discovery, reports explicit
unavailable/ambiguous identities, and does not mutate the caller checkout.

The PR remains draft and unmerged. Integration safety must be re-evaluated
against the then-current `feat/preference-first-selection` head before merge;
do not auto-merge, auto-rebase, or weaken governance checks to make it mergeable.

## Current checkpoint

Milestone 2B verification accepted. GOV-GATE-1 separates write and integration
readiness; GOV-LOCATE-1 supplies deterministic named-track discovery.

## Next authorized action

Design the minimal agent-level `resume` skill that composes `locate` with using
the registered worktree, `context`, preflight, and the next authorized action.
Before any integration attempt, rerun canonical preflight against the
then-current `feat/preference-first-selection` head; do not auto-merge,
auto-rebase, or resolve integration conflicts as part of this track.

## Open findings / blockers

- GOV-DISCOVERY-1: CLOSED. The 14-case governance fixture proves that
  `feat/current` does not contain `other.md`, `origin/feat/other` supplies its
  own ACTIVE progress header, `agent-track list` discovers that peer, and
  preflight reports real same-file overlap from branch deltas.
- GOV-GATE-1: CLOSED. Local preflight now reports a merge-tree conflict as
  INTEGRATION BLOCKED while preserving WRITE AUTHORIZED for a clean isolated
  checkout; CI keeps the same conflict as a hard integration failure.
- GOV-LOCATE-1: CLOSED. `locate` resolves ACTIVE IDs across worktrees and
  origin refs, rejects ambiguous IDs, and only reports registered worktrees.
- PR #70 is intentionally DRAFT and UNMERGED.
- The integration branch is active product work and may advance independently.
  Re-run canonical preflight/mergeability checks immediately before integration.
- No product/RW4 behavior changes are authorized from this governance track.
- Do not restore `owns=`, `touches=`, semantic ownership collision policy, or
  a manually synchronized central track registry.
