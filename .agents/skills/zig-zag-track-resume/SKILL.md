---
name: zig-zag-track-resume
description: Resume one already-authorized Zig-Zag collaboration track from its declared Git, progress, plan, and PR context.
---

# Zig-Zag track resume

For a named track, run `scripts/agent-track list`, select one exact discovered
ACTIVE ID, then run `scripts/agent-track locate <exact-track-id>`. For an
unnamed request, start with `scripts/agent-track context`; use list only when
the current context is not one unambiguous ACTIVE track. Never infer identity
from a branch name.

Use only the registered worktree returned by locate. If it says
`Worktree: <not registered>`, identity is ambiguous, or locate is unavailable,
stop. Do not alter the caller checkout and do not use Git branch/worktree
mutation merely to resume.

In the located worktree, run `scripts/agent-track context` and require track,
branch, worktree, integration target, progress, plan, and base snapshot to
agree with locate. If locate and context disagree, stop. Read `AGENTS.md`, the
declared progress and plan, and required architecture/spec documents. Recover
the current checkpoint, next authorized action, and blockers. Optionally read
the exact branch's PR/review context; a Fix Brief is actionable only when its
`reviewed_head == current HEAD`, and a material conflict with plan/progress
stops for human direction.

Run `bash scripts/agent-preflight`. On `WRITE BLOCKED`, stop before writes.
When integration is blocked, only isolated, already-authorized checkpoint work
may continue. Continue no further than bounded authorized work; stop for a
new milestone, unregistered worktree, ambiguity, context disagreement, or
required human decision. This command creates no durable track state.
