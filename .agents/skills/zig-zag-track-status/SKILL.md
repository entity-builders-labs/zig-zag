---
name: zig-zag-track-status
description: Show compact operational status for the Zig-Zag track in the current worktree.
---

# Zig-Zag track status

Run `scripts/agent-track context` in the current worktree, then report its
track, branch, worktree, HEAD, clean/dirty state, integration target, current
checkpoint, next authorized action, and open blockers/findings. Run
`bash scripts/agent-preflight` to report WRITE and INTEGRATION status
separately. This command creates no durable state.

When GitHub is available, read the open PR for the exact track branch and
report its number, draft state, head SHA, base, and CI/check state. If a
reviewed HEAD is discoverable from PR review artifacts, report `CURRENT` only
when `reviewed_head == current HEAD`; otherwise report `STALE`. Review remains
PR context, never progress-track metadata. If GitHub is unavailable, report
that limitation while retaining local status.
