# Agent Collaboration Foundation — Execution Plan

## Goal

Provide a checkout-local, tool-neutral collaboration contract so agents can
resume an active track, detect real branch overlap, and validate PR lineage
without a second project-management registry.

## Acceptance

- Progress documents declare explicit active-track identity and plan linkage.
- `scripts/agent-track` lists tracks and reports concise current-track context.
- A fresh agent can reconstruct the current checkpoint, next authorized action,
  and unresolved blockers/findings from canonical progress state without a
  manually rebuilt chat prompt.
- `scripts/agent-preflight` validates the same contract, integration lineage,
  mergeability, and actual changed-file overlap.
- PR/CI use preflight as the single deterministic governance policy.
- Architecture review has a documented warning contract; it is not bash CI.
- Detailed review fixes remain anchored to the PR/reviewed HEAD rather than
  becoming another repository workflow registry.

## Durable resume contract

The progress document owns only the execution delta needed to resume:

- current execution verdict;
- current checkpoint/gate;
- next bounded authorized action;
- unresolved blockers/findings.

The plan continues to own intended gates and acceptance. It does not need to
enumerate every implementation step.

A blocker/finding changing does not create a new milestone. The stable
checkpoint remains active until its acceptance condition is satisfied:

```text
checkpoint
  -> blocker
  -> bounded fix
  -> rerun verification
  -> next blocker, if any
```

`scripts/agent-track context` surfaces this state. It does not invent the next
action from branch names or prose elsewhere.

## Review handoff contract

PR review is the integration/review boundary. When changes are required, the
reviewer may emit a compact Fix Brief containing:

```text
track
reviewed_head
progress / plan context
finding IDs
required fixes
forbidden scope expansion
verification
```

That brief is a delta for the coder, not a replacement project prompt.

Review feedback stays tied to the reviewed PR/HEAD. Do not commit detailed
review output into the reviewed branch merely to persist the review, because
that would change HEAD and immediately stale the review anchor.

No autonomous reviewer->coder->review loop is authorized by this plan. Human
merge/control remains explicit.

## Branch/worktree selection

Git worktrees remain the isolation authority.

Shell governance should expose facts and registered worktree locations, not hide
destructive Git operations. Automatic checkout switching is not required for
this foundation. A future agent skill may use `agent-track` facts to select/open
the correct registered worktree, then run context + preflight there.

## Out of scope

No autonomous reviewer/coder loop, GitHub Projects/Issues synchronization,
rulesets, product behavior, manually maintained scope registry, or hidden
destructive branch switching.
