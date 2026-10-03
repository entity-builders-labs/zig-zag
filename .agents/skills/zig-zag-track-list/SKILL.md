---
name: zig-zag-track-list
description: List Zig-Zag ACTIVE collaboration tracks and their declared Git-backed context.
---

# Zig-Zag track list

Run `scripts/agent-track list` from the current repository worktree. Report
each discovered ACTIVE track's ID, branch, registered worktree, integration
target, progress document, and plan when the primitive exposes them.

This command is read-only. `agent-track` remains the sole discovery authority:
do not infer tracks from branch names, create a registry, or write state.
