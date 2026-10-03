# Contextual Review (OpenCode + Groq) — Progress

<!-- agent-track: id=contextual-review-groq; status=ACTIVE; branch=feat/contextual-review-groq; integration=feat/preference-first-selection; base=1ceb477de44b3589cbc01b13eac9bf7aa22c98da; plan=docs/superpowers/plans/2026-10-02-contextual-review-groq-plan.md -->

## Current execution verdict

**Bootstrap complete. Reviewer implementation NOT yet started.**

This track was bootstrapped manually from `origin/feat/preference-first-selection`
at `1ceb477de44b3589cbc01b13eac9bf7aa22c98da`, following the existing
`agent-track` header convention rather than introducing new governance. The
`zig-zag-track-start` skill does not exist and was explicitly not created.

Scope is bounded to replacing the failed inference harness in
`.github/workflows/zig-zag-contextual-review.yml`. The existing workflow
contract, the review artifact contract, the JSON schema, and the canonical
prompt authority are all preserved and unchanged.

No production behavior is in scope. RW4 code is untouched.

## Current checkpoint

**Track bootstrap — accepted.**

- Parent/integration: `feat/preference-first-selection` @ `1ceb477d`.
- New branch `feat/contextual-review-groq` created from the freshly fetched
  parent HEAD.
- Registered worktree `.worktrees/contextual-review-groq`.
- Plan and this progress document created on the track's own branch.
- Preflight after bootstrap reported `WRITE AUTHORIZED`.
- No second registry, alias, or duplicated track metadata was added.
  `docs/superpowers/README.md` is navigation, not a track registry, and the
  canonical Preference-First execution pointer is untouched.

Bootstrap preflight correctly reported `WRITE BLOCKED` on
`expected exactly one ACTIVE progress track for feat/contextual-review-groq`
before this header existed, and authorized writes only after it did. That
failure-then-authorize sequence is the intended bootstrap behavior, not a
governance defect.

## Next authorized action

Create the draft PR for `feat/contextual-review-groq` targeting
`feat/preference-first-selection`, filled from the track header, then implement
the reviewer per the plan's first milestone:

- deterministic incremental-baseline selection script plus its fixture tests;
- pinned OpenCode install and resolved Groq/Qwen model identifier;
- dedicated read-only reviewer agent/config;
- two-phase inspect-then-normalize invocation;
- deterministic tests 1–12.

## Open findings / blockers

- `openai/codex-action` and the direct Codex CLI both fail against Groq because
  Groq rejects their Responses API request bodies. Neither integration may be
  retried. This is the defect this track exists to remove.
- Whether OpenCode + Groq survives the tool-calling/protocol boundary is
  unproven. It is the first thing the live calibration must establish, and the
  plan's hard provider stop applies if it does not.
- The OpenCode provider-qualified model identifier for Qwen 3.8 27B must be
  resolved from the installed version's model discovery; the Groq API model ID
  must not be assumed to be identical.
- Real GitHub Actions execution is required for acceptance. A green unit suite
  is not completion.
