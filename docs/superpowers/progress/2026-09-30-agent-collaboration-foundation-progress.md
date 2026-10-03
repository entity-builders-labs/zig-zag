# Agent Collaboration Foundation — Progress

<!-- agent-track: id=agent-collaboration-foundation; status=ACTIVE; branch=chore/agent-collaboration-foundation; integration=feat/preference-first-selection; base=74a545f2f4b1f724fe4cfa6f23c804b281b90f02; plan=docs/superpowers/plans/2026-09-30-agent-collaboration-foundation-plan.md -->

## Current execution verdict

**Milestone 2B — HISTORICALLY ACCEPTED ON GOVERNANCE BRANCH / NOT YET
INTEGRATED. Milestone 3A — ACCEPTED ON GOVERNANCE BRANCH / PUBLISHED TO DRAFT
PR #70. Milestone 3B — ACTIVE / BLOCKED ON REVIEW PROVIDER.**

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

The deterministic governance surface is now repaired and verified locally:
ShellCheck exits 0 on the four governance scripts, the governance fixture suite
exits 0 across 58 assertions, `scripts/agent-progress-gate` passes, and
`git diff --check` is clean.

Milestone 3B is BLOCKED, not complete, on review provider compatibility: the
Codex CLI request body is not accepted by Groq's OpenAI-compatible surface. No
canonical review can be published for this track or for the integration branch
until a provider that accepts the Codex request body is chosen. That provider
decision is a human call; this track will not build another adapter, proxy, or
framework to work around it.

## Current checkpoint

Milestone 3B — the deterministic review machinery is implemented and
published, but the checkpoint is BLOCKED on review provider compatibility, so
Milestone 3B is not complete. The workflow shape is verified: Codex executes in
read-only sandbox, structured output validates, and the review artifact
publishes to PR #70 with `commit_id` binding via `gh api -F body=@file`. The
workflow validates the real PR head SHA, exposes discovery ambiguity
explicitly, writes review input to `$RUNNER_TEMP`, and enforces canonical review
authenticity. What it cannot currently do is obtain a model response, because
the configured provider rejects the Codex CLI request body.
The progress freshness gate handles detached HEAD in CI via `GITHUB_HEAD_REF`
in both `agent-track context` and the gate script, and is enforced both
locally (publish skill) and in CI (`track-progress-freshness`).

Three contextual-review findings are resolved: GOV-REMOTE-OVERLAP-1 (registered
stale peer no longer hides fetched remote overlap via `discover_overlap_refs`),
GOV-SHELLCHECK-1 (mandatory ShellCheck command passes), and
GOV-REVIEW-BINDING-1 (duplicate-review detection requires `commit_id == SHA`).

GOV-REMOTE-OVERLAP-2 is resolved: there is exactly one
`discover_overlap_refs()` definition. It collects refs from both
`registered_worktree_track_records` and `remote_track_records` before identity
deduplication, preserving distinct Git tips even when declarations are
identical, and dedupes only identical refs. `list`/`locate` still deduplicate by
logical identity. The dead `track_ref_for_branch` helper is removed, and
preflight has a single canonical overlap-inspection loop. The SC2329 info
diagnostic is suppressed with a documented directive for indirect invocation
via process substitution.

The `track-progress-freshness` CI job is added to enforce progress freshness
on every PR head. The `agent-governance` job runs preflight, ShellCheck, and
the governance fixture suite.

GOV-SHELLCHECK-2 is resolved: all SC2015 diagnostics in `scripts/agent-track`
are fixed with explicit if/else conditionals. The mandatory ShellCheck command
passes with exit code 0.

GOV-SPEC-2 is resolved. The fixture suite now reaches and passes its last
assertion (58 cases, exit 0). Three defects blocked it: the registered
stale-peer case wrote identical `shared.txt` content on both sides so the
`current-change` commit was empty; `locate other` was already ambiguous from
earlier same-ID fixture branches, so that case used a dedicated track ID; and
the review-binding jq asserted `length == 0` while every predicate matched,
making the mismatched-commit case vacuous. The suite now asserts behavior
instead of unreachable expectations.

The committed review workflow still points `openai/codex-action` at Groq's
Responses API (`GROQ_API_KEY`, `responses-api-endpoint`,
model `qwen/qwen3.8-27b`, high reasoning effort, `:read-only` permission
profile). That configuration cannot produce a review: the Codex CLI request
body is rejected by Groq.

The direct Codex CLI + Groq migration is stopped at its explicit abort
condition. Sanitized failure evidence, reproducible against Groq with a plain
HTTP replay of the captured body:

- `unknown field client_metadata in request body`
- `Field 'include' is not supported`
- `failed to render text output: ... Unexpected message role.`
- `invalid JSON body`

Codex CLI 0.159.2 and 0.160.0 always send `client_metadata` and
`include: ["reasoning.encrypted_content"]`, and ship non-standard tool types.
No configuration knob suppresses those fields, so the incompatibility is a
protocol/body mismatch, not a configuration error. Standard function tools
alone are accepted, and Groq's `/v1/responses` answers plain curl requests.

## Next authorized action

Publish the repaired deterministic governance state to PR #70 and require the
`agent-governance` and `track-progress-freshness` CI jobs to pass. Report the
review-provider blocker to the human owner and wait for an explicit provider
decision. Do not merge, do not retry an alternative provider, and do not begin
an autonomous fix loop.

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
- Milestone 3B live review: CLOSED as a publication-path fix. Schema fix (add
  `line` to `findings[].required`), jq fix (iterate `.findings[]`), CI head
  validation, discovery ambiguity, and reviewer harness cleanliness are all
  committed and published.
- GOV-REVIEW-PROVIDER-1: OPEN, BLOCKING. No canonical contextual review can be
  published while Groq rejects the Codex CLI request body. Affected: this
  track's own review, and the first product review of the integration branch.
  Requires a human provider decision. No adapter, proxy, or framework
  workaround is authorized from this track.
- GOV-SPEC-1: CLOSED. The fixture suite asserted unreachable expectations
  rather than behavior. The registered stale-peer case could not commit because
  both sides wrote identical `shared.txt` content; it now uses a dedicated track
  ID so `list`/`locate` prove one logical identity across distinct refs. The
  review-binding cases asserted `length == 0` while every predicate matched, so
  the mismatched-commit case passed vacuously; a single shared filter now
  implements the contract's canonical rules (publisher author, eligible state,
  exact marker, `commit_id == reviewed_head`, both verdict fields) and adds the
  copied-marker and missing-verdict cases.
- GOV-MESSAGE-1: CLOSED. Overlap warnings name the offending ref
  (`file overlap:<ref>`) so every warning is traceable and greppable.
- PR #70 is intentionally DRAFT and UNMERGED.
- The integration branch is active product work and may advance independently.
  Re-run canonical preflight/mergeability checks immediately before integration.
- No product/RW4 behavior changes are authorized from this governance track.
- Do not restore `owns=`, `touches=`, semantic ownership collision policy, or
  a manually synchronized central track registry.
