---
name: zig-zag-track-review
description: Inspect or retry the canonical GitHub contextual review for the current Zig-Zag track PR.
---

# Zig-Zag track review

Read `.github/codex/track-review-contract.md`. The pull-request review artifact
is authoritative: report `CURRENT` only when its valid marker's
`reviewed_head` equals the current PR HEAD; otherwise report `STALE`.

Run `scripts/agent-track context` and `bash scripts/agent-preflight` first.
Use GitHub read-only access to locate the one open PR for the declared branch,
verify its base equals the declared integration target, and inspect its head and
contextual-review markers. Do not infer identity from a branch name.

For a `STALE` or unavailable review, trigger the canonical
`Zig-Zag Contextual Review` workflow with `workflow_dispatch` and its PR-number
input. It resolves the PR's current head itself. Never imitate the PR review
locally, create review state, or use a second prompt/policy. If workflow
dispatch is unavailable, report this manual retry path exactly:

```text
Actions → Zig-Zag Contextual Review → Run workflow → pr_number=<PR number>
```

This command never edits repository contents, creates commits, pushes, merges,
or changes progress metadata.
