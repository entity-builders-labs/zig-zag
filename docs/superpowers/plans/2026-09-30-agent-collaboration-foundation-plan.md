# Agent Collaboration Foundation — Execution Plan

## Goal

Provide a checkout-local, tool-neutral collaboration contract so agents can
resume an active track, detect real branch overlap, and validate PR lineage
without a second project-management registry.

## Acceptance

- Progress documents declare explicit active-track identity and plan linkage.
- `scripts/agent-track` lists tracks and reports concise current-track context.
- `scripts/agent-preflight` validates the same contract, integration lineage,
  mergeability, and actual changed-file overlap.
- PR/CI use preflight as the single deterministic governance policy.
- Architecture review has a documented warning contract; it is not bash CI.

## Out of scope

No autonomous reviewer/coder loop, GitHub Projects/Issues synchronization,
rulesets, product behavior, or manually maintained scope registry.
