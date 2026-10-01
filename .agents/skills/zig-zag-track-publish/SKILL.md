---
name: zig-zag-track-publish
description: Publish a prepared Zig-Zag track branch to its existing declared integration pull request.
---

# Zig-Zag track publish

Publish only the current worktree's already-committed track state. Run
`scripts/agent-track context` and `bash scripts/agent-preflight`; stop on
`WRITE BLOCKED` or `INTEGRATION BLOCKED`. Stop if tracked or untracked files
make the publication state dirty or ambiguous. Do not stage, commit, delete,
or otherwise repair that state automatically.

Use the context's exact declared branch and integration target. Query GitHub
for open PRs whose head branch is that exact branch in
`entity-builders-labs/zig-zag`: zero is `STOP: no integration PR`, more than
one is `STOP: ambiguous`, and exactly one may proceed only when its base branch
equals the declared integration target. A draft PR is valid.

For that one PR, verify its head repository and head branch. Require the PR
head repository to be `entity-builders-labs/zig-zag`, and require `origin` to
resolve to that same repository before pushing `HEAD` to its exact head branch.
If either identity differs, stop rather than inferring or redirecting to a
fork. Run `git diff --check`. For governance changes also run:

```text
shellcheck scripts/agent-track scripts/agent-preflight scripts/agent-governance.spec.sh
bash scripts/agent-governance.spec.sh
```

Run any additional bounded validation required by the current track's
AGENTS/progress/plan contract. Only after all gates pass, push the declared
current branch to the already-verified PR head remote/branch. Re-read the PR
and require its head SHA to equal the pushed HEAD. Report CI/check and review
follow-up, with review `CURRENT` only when `reviewed_head == current HEAD`.

This command never creates or merges a PR, chooses among PRs, rebases or merges
the integration target, or creates persistent review/track state.
