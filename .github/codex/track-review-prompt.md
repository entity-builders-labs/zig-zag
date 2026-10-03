# Zig-Zag contextual pull-request review

Read the file at `$REVIEW_INPUT_FILE` first. It supplies the authoritative
track, PR number, exact reviewed SHA, base branch, and integration-diff command
for this run, plus a PR metadata and check-evidence snapshot. Treat those values
as fixed facts. Do not edit files, make
commits, push, create a PR, merge, rebase, change labels, or change track state.

Review the exact checked-out PR head. First read `AGENTS.md`, then run
`scripts/agent-track context`; use its declared progress and plan paths and
read both documents. Follow every mandatory architecture/spec document that
`AGENTS.md` makes applicable to the changed area. Run
`bash scripts/agent-preflight` as read-only evidence. Inspect the complete
integration diff using the command in the input file, then inspect relevant
call sites, surrounding code, and tests. Inspect available CI/check evidence
when accessible, but report it as PASS, FAIL, PENDING, or UNAVAILABLE at review
time; do not wait indefinitely or claim final CI knowledge.

Review both correctness and architecture/governance alignment. Do not merely
summarize the diff. Relevant architecture checks include duplicate policy
authority, provider leakage, hidden metadata protocols, magic semantic defaults,
obsolete compatibility paths, scope expansion, weakened tests, track-state
duplication/manual registries, destructive Git behavior, invalid worktree
semantics, persisted review state, automatic integration, and coder loops.
Only report categories that apply. Continue through the whole diff after an
issue is found. Do not emit style nits unless they materially affect correctness,
maintainability, architecture, or the repository contract.

Return only JSON conforming to `.github/codex/track-review-schema.json`. The
`track`, `pr_number`, `reviewed_head`, and `base_branch` fields must exactly
match the input file. Each finding must be specific and actionable. The
`line` field is always required; use `""` (empty string) when no concrete
source line or range applies. Set
`code_review_verdict` to `PASS` or `CHANGES_REQUIRED`, and
`architecture_verdict` to `ARCHITECTURE_PASS` or
`ARCHITECTURE_DRIFT_WARNING`. Use an empty findings array when there are no
actionable findings.
