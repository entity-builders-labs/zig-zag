# Agent Collaboration Foundation — Progress

<!-- agent-track: id=agent-collaboration-foundation; status=ACTIVE; branch=chore/agent-collaboration-foundation; integration=feat/preference-first-selection; base=74a545f2f4b1f724fe4cfa6f23c804b281b90f02; plan=docs/superpowers/plans/2026-09-30-agent-collaboration-foundation-plan.md -->

## Current execution verdict

**Milestone 2B — DISCOVERY FIX IMPLEMENTED / VERIFICATION PENDING.**

The former initiative registry and manual semantic-ownership model have been
replaced by progress-owned track identity, actual branch-diff overlap warnings,
and checkout-local track context. The originally scoped implementation and
deterministic verification are complete.

Architecture review found one foundation-level discovery gap: peer-track
discovery was scoped to progress files visible in the current checkout, so a
sibling track whose progress file existed only on its own branch/worktree could
be invisible from the other track.

The bounded fix is now implemented: current-track authority still comes from the
current checkout, while peer discovery derives ACTIVE track identity from
registered worktrees plus fetched `origin/*` branch refs, filtered by each
track's own declared `branch=`. No central registry or manual scope tokens were
added. Acceptance remains pending until the updated shell verification runs.

The PR remains draft and unmerged. Integration safety must be re-evaluated
against the then-current `feat/preference-first-selection` head before merge;
do not auto-merge, auto-rebase, or weaken governance checks to make it mergeable.

## Current checkpoint

Verify the peer-track discovery fix and durable resume contract.

The stable Milestone 2B remains the checkpoint. This finding does not create a
new milestone: the bounded fix is implemented; rerun governance verification and
then reassess acceptance.

## Next authorized action

Run the governance verification for the current HEAD:

```text
shellcheck scripts/agent-track scripts/agent-preflight scripts/agent-governance.spec.sh
bash scripts/agent-governance.spec.sh
git diff --check
```

The updated spec now includes the branch-local peer case: `feat/current` must
discover `feat/other` even though `other.md` does not exist in the current
branch tree.

After those checks pass, reclassify Milestone 2B for acceptance. Do not move on
by hiding or weakening a failing governance check.

## Open findings / blockers

- GOV-DISCOVERY-1: FIX IMPLEMENTED, VERIFICATION PENDING. Peer-track discovery
  now uses registered worktrees plus fetched remote branch refs; the new
  branch-local-peer regression case has not yet been executed on this HEAD.
- PR #70 is intentionally DRAFT and UNMERGED.
- The integration branch is active product work and may advance independently.
  Re-run canonical preflight/mergeability checks immediately before integration.
- No product/RW4 behavior changes are authorized from this governance track.
- Do not restore `owns=`, `touches=`, semantic ownership collision policy, or
  a manually synchronized central track registry.
