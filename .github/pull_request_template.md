# Summary

Describe the change, why it exists, and the user/system behavior it affects.

Related issue / plan / acceptance gate: <!-- link or N/A -->

## Track contract

Fill these from the ACTIVE progress-track header.

- Track:
- Progress:
- Plan:
- Branch:
- Integration target:

- [ ] This PR targets the track's declared integration branch.
- [ ] The branch has exactly one ACTIVE progress-track header.
- [ ] `bash scripts/agent-preflight` returned `WRITE AUTHORIZED` before implementation.

> `CODEOWNERS` routes human review. It does not grant track or domain authority.

## Scope

### Changed behavior

<!-- What changed? -->

### Production files changed

<!-- List production files, or write NONE. -->

### Explicitly out of scope

<!-- Important nearby behavior intentionally not changed. -->

## Verification

List the commands/checks actually run and their results. Do not mark unrun work
as passing.

```text
tests:
typecheck:
lint:
build:
other:
```

For live/external-provider checks, use strict evidence language:

- PROVEN
- BLOCKED
- NOT RUN
- INCONCLUSIVE

## Engineering-principles gate

Mark only applicable categories.

- [ ] Provider isolation: PASS / N/A
- [ ] Typed boundaries: PASS / N/A
- [ ] Single policy authority: PASS / N/A
- [ ] Unknown / no-magic-default semantics: PASS / N/A
- [ ] Dependency direction: PASS / N/A
- [ ] Migration / cutover completeness: PASS / N/A
- [ ] Frontend domain ownership: PASS / N/A
- [ ] No obsolete compatibility path left reachable: PASS / N/A

Describe any non-obvious architectural review:

<!-- findings -->

## Integration safety

- [ ] No direct push to `main`.
- [ ] No force-push or history rewrite unless explicitly authorized.
- [ ] No unrelated initiative/worktree was modified.
- [ ] CI `agent-governance` runs the canonical `scripts/agent-preflight --ci`
      rather than reimplementing collaboration policy.
- [ ] Any warning from preflight/CI has been reviewed and is understood.

## Final status

<!-- For milestone/gate PRs, state CLOSED/OPEN/BLOCKED precisely. -->
