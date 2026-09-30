---
name: resume-track
description: Resume an already-authorized Zig-Zag work track from durable repository, Git, progress, plan, preflight, and optional PR-review context. Use for requests such as "continue the work", "resume this track", "continúa con el trabajo", "seguí con governance", or "retomá Preference-First".
---

# Resume an authorized track

Use this skill only to resume an already-authorized Zig-Zag checkpoint. It
composes repository authorities; it creates no durable track state, aliases, or
review registry.

## Select the track

- For an unnamed request, first run `scripts/agent-track context` from the
  caller's current checkout. Use the result only if it identifies one ACTIVE
  track. Otherwise run `scripts/agent-track list` and continue only if one
  intended ACTIVE track is unambiguous. Never use chat memory as track state.
- For a named request, run `scripts/agent-track list`. Interpret the human
  phrase only against the discovered ACTIVE track IDs and branches. If no track
  or more than one track plausibly matches, stop and report the ambiguity.
- After selecting an exact ID, run `scripts/agent-track locate <exact-track-id>`.
  Do not bypass locate with a branch-name inference. If locate reports an
  unavailable or duplicate identity, stop.

## Use the registered worktree

If locate reports `Worktree: <not registered>`, stop and report that the track
exists but has no registered worktree. Do not create or remove worktrees
automatically.

When locate returns a registered worktree, use it as the working directory for
all subsequent repository commands. Leave the caller checkout untouched. Never
mutate a branch or worktree merely to resume.

Run `scripts/agent-track context` inside that worktree. Require track ID,
branch, integration target, progress path, and plan path to agree with locate.
If locate and context disagree, stop and report the governance inconsistency;
do not choose a source.

## Reconstruct only current context

Read `AGENTS.md`, then the progress and plan paths returned by context. Read
only the architecture/spec documents that `AGENTS.md` requires for the current
next authorized action. Recover: track, branch, worktree, integration target,
base snapshot, current checkpoint, next authorized action, and open
findings/blockers.

Do not rebuild a historical prompt or persist a separate summary. Progress owns
execution state; plans/specs own acceptance and architecture; Git owns refs,
worktrees, and actual deltas; PR/review owns review artifacts; `agent-track`
and `agent-preflight` own deterministic discovery and safety.

## Reconstruct review context when available

When GitHub access is available, inspect the open PR for the located branch,
its unresolved findings, and any Fix Brief. Treat a Fix Brief as current only
when its `reviewed_head` equals the current track HEAD. Report a stale Fix Brief
and do not execute it blindly.

A current Fix Brief may constrain implementation only within canonical
progress/plan scope. If review conflicts materially with progress, plan, or
required specifications, stop for a human decision. If GitHub/review access is
unavailable, report that limitation and continue only from sufficient canonical
repository context. Do not invent findings or run an autonomous review loop.

## Preflight and execute the current checkpoint

Run `bash scripts/agent-preflight` after context reconstruction.

- On `WRITE BLOCKED`, stop before durable writes.
- On `WRITE AUTHORIZED` with `INTEGRATION READY`, perform the current already-
  authorized action only.
- On `WRITE AUTHORIZED` with `INTEGRATION BLOCKED`, isolated work inside the
  current checkpoint may proceed, but integration actions may not. If the next
  authorized action requires integration, stop.

Within one invocation, work only through the existing checkpoint: concrete
blocker, bounded fix, required verification, then another blocker that remains
inside that checkpoint. Stop before an explicit human approval gate, a new
milestone, blocked integration, a product/architecture decision requiring human
judgment, or scope expansion. This is a resume workflow, not a workflow engine.
