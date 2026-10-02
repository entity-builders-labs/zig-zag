# Agent Collaboration Foundation — Progress

<!-- agent-track: id=agent-collaboration-foundation; status=ACTIVE; branch=chore/agent-collaboration-foundation; integration=feat/preference-first-selection; base=74a545f2f4b1f724fe4cfa6f23c804b281b90f02; plan=docs/superpowers/plans/2026-09-30-agent-collaboration-foundation-plan.md -->

## Current execution verdict

**Milestone 2B — HISTORICALLY ACCEPTED ON GOVERNANCE BRANCH / NOT YET
INTEGRATED. Milestone 3A — ACCEPTED ON GOVERNANCE BRANCH / PUBLISHED TO DRAFT
PR #70. Milestone 3B — ACTIVE.**

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

The minimal `resume-track` skill design is accepted in the governance plan. It
is a non-persistent composition of `agent-track`, canonical documents, optional
PR/review context, and preflight; it does not create another registry or
authority. The design explicitly stops for ambiguous identity, an unregistered
worktree, context disagreement, blocked writes, stale/conflicting Fix Briefs,
and forbidden integration.

The approved generic resume skill was implemented for 2B and its then-current
suite passed 25 cases. Milestone 3A deletes that public surface and replaces it
with the namespaced command set under the early-stage deletion rule.

GOV-TRACK-OWNERSHIP-1 corrects header ownership: Preference-First bootstraps
its own ACTIVE header through a metadata-only commit on its own branch, while
this governance branch removes the foreign header patch. Discovery remains
registered-worktree plus fetched-ref based; no registry or duplicate metadata
was introduced.

GOV-OVERLAP-1 replaces asymmetric integration-relative overlap warnings with
pairwise deltas since each current/peer common merge base. Inherited parent
history no longer appears as concurrent overlap; unavailable pairwise ancestry
is reported visibly rather than treated as no overlap.

This already-running client session cannot prove fresh-session discovery of a
skill created after the session began. No concrete discovery failure was
observed, and no client-specific adapter or duplicate instructions were added;
verify discovery in a fresh supported client session before adding one.

Milestone 3A replaced the generic public `resume-track` surface with the four
namespaced track commands and was committed and published at
`07031da76af95d61d02403e3172826432bed1143` to draft PR #70. It preserves the
accepted 2B discovery, locate, preflight, overlap, and worktree contracts.

Milestone 3B is the active, bounded contextual-review checkpoint. It adds a
push-triggered, read-only, HEAD-anchored Codex review for the existing track
PR contract, without persisting review state into track metadata or creating
an autonomous coder/fixer/integration loop.

The 3A command skills and deterministic governance coverage are implemented,
committed, and published. Milestone 3B publication remains subject to the
exact publication and remote-identity gates.

## Current checkpoint

Milestone 3B — implementation, verification, and publication are complete.
The contextual review workflow runs end-to-end: Codex executes in read-only
sandbox, structured output validates, and the review artifact publishes to
PR #70 with `commit_id` binding via `gh api -F body=@file`. The workflow
validates the real PR head SHA, exposes discovery ambiguity explicitly, writes
review input to `$RUNNER_TEMP`, and enforces canonical review authenticity.
The progress freshness gate handles detached HEAD in CI via `GITHUB_HEAD_REF`
in both `agent-track context` and the gate script, and is enforced both
locally (publish skill) and in CI (`track-progress-freshness`).

## Next authorized action

Monitor the contextual review workflow for PR #70's current head. Do not
merge or begin an autonomous fix loop.

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
- GOV-TRACK-OWNERSHIP-1: CLOSED. An ACTIVE track owns its own progress header;
  foreign tracks must not patch it merely for discovery.
- GOV-OVERLAP-1: CLOSED. Same-file warnings compare pairwise divergent paths,
  not each track's separate integration-relative history.
- Milestone 3A must not restore generic public command names, a registry,
  branch-name inference, hidden worktree mutation, automatic PR creation or
  merge, fork guessing, or persisted review status.
- Milestone 3A: CLOSED / PUBLISHED at
  `07031da76af95d61d02403e3172826432bed1143` on draft PR #70.
- Milestone 3B must keep contextual review in the PR artifact layer: no
  progress review fields, no local imitation of authoritative review, no
  automatic coder/fixer loop, push, merge, or integration behavior.
- Milestone 3B live review: CLOSED. The contextual review workflow runs
  end-to-end. Schema fix (add `line` to `findings[].required`), jq fix
  (iterate `.findings[]`), CI head validation, discovery ambiguity, and
  reviewer harness cleanliness are all committed and published.
- PR #70 is intentionally DRAFT and UNMERGED.
- The integration branch is active product work and may advance independently.
  Re-run canonical preflight/mergeability checks immediately before integration.
- No product/RW4 behavior changes are authorized from this governance track.
- Do not restore `owns=`, `touches=`, semantic ownership collision policy, or
  a manually synchronized central track registry.
