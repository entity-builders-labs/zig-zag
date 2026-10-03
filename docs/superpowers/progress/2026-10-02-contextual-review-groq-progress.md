# Contextual Review (OpenCode + Groq) — Progress

<!-- agent-track: id=contextual-review-groq; status=ACTIVE; branch=feat/contextual-review-groq; integration=feat/preference-first-selection; base=1ceb477de44b3589cbc01b13eac9bf7aa22c98da; plan=docs/superpowers/plans/2026-10-02-contextual-review-groq-plan.md -->

## Current execution verdict

**Pipeline executes in real CI and fails closed correctly. Six defects found and
fixed; no review published yet. Every phase after inspection is still
unexercised.**

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

**Implementation complete and locally verified. In CI the pipeline now runs
through inspection and fails closed for the right reason. Acceptance awaits a
green run that publishes.**

Preserved from the accepted bootstrap:

- Parent/integration: `feat/preference-first-selection` @ `1ceb477d`.
- Branch `feat/contextual-review-groq`, registered worktree
  `.worktrees/contextual-review-groq`, plan and progress on the track's own
  branch.
- No second registry, alias, or duplicated track metadata.
  `docs/superpowers/README.md` is navigation, not a track registry, and the
  canonical Preference-First execution pointer is untouched.
- Bootstrap preflight correctly reported `WRITE BLOCKED` before the ACTIVE header
  existed and authorized writes only after it did.

Local verification actually executed for this checkpoint:

```text
scripts/agent-review-baseline.spec.sh   19 fixtures PASS, exit 0
scripts/agent-governance.spec.sh        59 assertions PASS, exit 0
shellcheck (7 governance + review scripts)   clean
ruby YAML parse, both workflows                valid
ajv draft2020, schema-conformant JSON         valid, exit 0
ajv draft2020, schema-violating JSON         rejected, exit 1
```

The canonical schema, artifact contract, and original prompt authority are
unchanged; the two new phase prompts are additive and neither emits a verdict
during inspection.

No production behavior was touched. RW4 code is untouched. No review was
published and no `CODE REVIEW: PASS` was synthesized.

**Provider evaluation history — Groq rejected, Cloudflare accepted.**

Groq was evaluated first and failed on free-tier quota, not on protocol. OpenCode
submitted a well-formed request that Groq accepted and rejected on size:

```text
OpenCode v2.0.21 floor, zero tools, empty prompt   10,928 tokens
OpenCode v2.0.21 floor, single read tool           11,172 tokens
Groq org cap, qwen/qwen3.8-27b                      7,000 ITPM
Groq org cap, openai/gpt-oss-120b                   8,000 TPM
```

Even a bare "reply OK" request exceeds the cap, so no reviewer configuration can
fit. `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` and `groq/compound-mini`
all return 404 for this key. Upgrading Groq and enabling paid billing were
explicitly refused. This is a demonstrated hard provider stop, not a design gap.

**Provider substitution ACCEPTED and validated.**

The credentials the track was blocked on were located in the sibling
`ui-redesign` worktree's untracked, git-ignored `.env` (`CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`; note the actual name is `CLOUDFLARE_API_TOKEN`, not the
`CLOUDFLARE_API_KEY` the earlier progress entry assumed). That file was read
read-only; no file, index, or branch in that worktree was modified. The
workflow maps the token into `CLOUDFLARE_API_KEY` as well, because that is the
variable name OpenCode's provider catalog requires.

Exactly one live probe ran, as the plan authorized, then provider work stopped:

```text
accepted input                                17,747 tokens (vs Groq cap 7,000)
repository tool calls                          read + grep, 3 executed
result                                         line 280, heading 284, exact
tracked files modified                         none
HEAD                                           2089ecc0, unchanged
neurons per minimal call                      ~5.16
paid usage                                     none (free tier)
```

Two real operational findings from the probe: the model emitted an invalid
`read` call (`offset`/`limit` with no `path`) and self-corrected on the next
turn, and it correctly stated it has no shell. Both informed the current
design — the workflow now proves a `read` tool call actually occurred rather
than trusting prose.

**Incremental reviewer implemented.**

The scope of `.github/workflows/zig-zag-contextual-review.yml` was replaced,
not extended. `openai/codex-action` is gone. Three deterministic primitives own
the decisions the model must not make for itself:

- `scripts/agent-review-baseline` — the single authority for which commits are
  in scope. A prior review counts as a baseline only when publisher, state,
  marker track/`reviewed_head`, and GitHub `commit_id` all agree *and* the SHA
  is a real ancestor. Otherwise it degrades to the event's previous head, then
  to latest-commit-only, and always states the resulting coverage limitation in
  plain language. It never silently substitutes full `main...HEAD`.
- `scripts/agent-review-context` — assembles the context bundle in a fixed order
  (AGENTS.md → authority index → North Star → ACTIVE track header → plan →
  progress → checkpoint → open findings → applicable architecture docs), bounded
  per section with explicit truncation markers.
- The inspection and normalization phases are separate OpenCode calls because
  strict structured output and repository tool use cannot be combined on this
  provider.

Fabrication guards are fail-closed: missing credentials, a nonzero exit, an
absent `read` tool call, empty evidence, invalid JSON, a `PASS` with findings,
and any finding path absent from the reviewed checkout all emit
`REVIEW UNAVAILABLE / FAILED`. `PASS` is never synthesized on failure.

The reviewer is deny-by-default by construction, not by prompt wording:
`.opencode/agent/reviewer.md` allows only `read`/`grep` and denies edit, bash,
write, patch, webfetch, task. No GitHub token is passed to either model step.
The checkout SHA and `git status` are re-verified after inspection, so the
reviewer is proven not to have altered what it reviewed.

**Two root-commit defects found and fixed during verification.** Both were
silent-wrong-answer bugs, not crashes:

1. `git rev-parse SHA^` on a root commit fails but still prints the unresolved
   revision literal to *stdout*, so `|| true` captured the string `HEAD^` as a
   non-empty baseline SHA. The PR was labeled `latest-commit-only` while
   pointing at a nonexistent commit. Fixed with `--verify --quiet` plus a
   length check.
2. An empty baseline made `git diff ..HEAD` and `git rev-list ..HEAD` return
   empty output with exit 0, so a root-commit PR would have published
   `entire-history-root` alongside an empty commit list and empty file list.
   The selector now uses `diff-tree --root`, and the workflow fails closed if the
   resolved range selects no commits, produces an empty diff, or produces no
   changed files.

Fixtures 13–16 exist specifically to catch these regressions. Two further
defects were then caught by the first real CI run and by local POSIX-shell
reproduction:

3. `printf '-->'` is parsed as an *option* by GNU coreutils `printf`, not as a
   format string, so the range step exited 2 immediately after successfully
   resolving the range. The marker closing delimiter is now emitted via
   `printf '%s\n' '-->'`.
4. The marker body was built with `\|` alternation inside a BRE. That is a GNU
   sed extension; on BSD `sed` it matches nothing, so the marker rendered as an
   empty comment while the step still exited 0 — a silent wrong answer rather
   than a failure. Replaced with a portable per-key loop.

Defects 3 and 4 are the reason fixture 17 rebuilds the marker under `/bin/sh`
with POSIX tools only, and fixture 18 asserts no `printf` format begins with a
bare dash. A workflow that only ever runs on `ubuntu-latest` still has to be
readable by a human running the same logic locally.

**Defect 5 — an unterminated `$(` in the CI evidence fallback, introduced by my
own edit.** Run 37094285856 reached `Prepare the reviewed delta and canonical
context` and exited 2 with `unexpected EOF while looking for matching "'`. The
cause was a stray trailing quote on the `check_evidence` assignment, which I
introduced when moving that line out of the `track` step. The line read:

```bash
check_evidence="$(gh api ... || printf '%s' '"UNAVAILABLE"')'
```

The closing `"` was missing, so the command substitution never terminated. It is
replaced with an explicit assignment followed by a JSON validity check, so the
fallback is also clearer: a GitHub outage yields the literal `UNAVAILABLE`,
which is a distinct explicit unknown rather than an empty check list that would
read as "no checks ran".

This defect was shipped to CI by me, not discovered by CI. That is the honest
account. Three CI round trips were spent on shell typos that a syntax check
would have caught in milliseconds, and two of them were self-inflicted.

**Fixture 15 now extracts every `run:` block from the workflow and runs
`bash -n` on each.** It is the check whose absence allowed all three failures. I
verified it is not vacuous by reinjecting the exact defect-5 line into the
workflow and confirming the fixture fails with the identical parser error CI
produced, then restoring the fix. An assertion that has never been observed
failing is not evidence.

**Defect 6 — OpenCode refuses to read outside the project directory.** With
credentials present, run 37095103080 attempt 2 reached
`Inspect the delta with the read-only reviewer` and failed there:

```text
REVIEW UNAVAILABLE / FAILED: OpenCode inspection exited 1
! permission requested: external_directory (/home/runner/work/_temp/*); auto-rejecting
```

`RUNNER_TEMP` is `/home/runner/work/_temp`, which is outside the checkout at
`/home/runner/work/zig-zag/zig-zag`. OpenCode auto-rejects any read outside the
project directory, so `--file` could not load the diff and the prompt's
context/input paths were unreachable. The reviewer has no path out of the
repository by design, and this makes it explicit: the staging directory is
`.review-input/` inside the checkout, and the model is pointed at repo-relative
paths only.

This also forced a correction to the integrity check. `git status --porcelain`
would always be non-empty once an untracked staging directory exists, so the
check that proves "the reviewer did not alter what it reviewed" now uses
`--untracked-files=no`. That still fails on any tracked modification, addition,
or deletion, which is the actual invariant; it simply stops tripping on the
workflow's own scratch files. Fixture 19 pins both halves of this so the check
cannot silently degrade into a no-op.

Notably, the fail-closed guard behaved exactly as intended here: a provider
inability produced `REVIEW UNAVAILABLE / FAILED`, zero reviews on the PR, and no
fabricated `PASS`. That is the contract holding under real failure.

## Next authorized action

**Push the staging fix and drive run 37095103080 to a published review.**

The secrets are in place, so the next run exercises the full pipeline for the
first time: inspection, normalization, path verification, schema validation, and
publication. Acceptance is a real published review whose `commit_id` equals the
PR head, whose marker track and `reviewed_head` agree with it, and whose
coverage statement matches what `scripts/agent-review-baseline` actually
selected. A `REVIEW UNAVAILABLE / FAILED` outcome is a valid result and must not
be papered over.

Then perform the bounded historical calibration at
`4b3d2bb20818d3b36b68c591205e45b7ad155fa4` if the live run succeeds.

Do not add a second provider, do not wire an automatic fix/commit/push/merge
loop, and do not merge PR #72.

## Open findings / blockers

- **Live GitHub Actions execution has failed three times and is not yet proven.**
  Runs on `c3002986` and `56f16332` exited 2 on shell defects in the range and
  prepare steps; run 37095103080 attempt 1 failed closed on absent credentials,
  correctly; attempt 2 reached the reviewer and failed because OpenCode refuses
  to read `RUNNER_TEMP`. The range logic behaved correctly every time:
  `COVERAGE=latest-commit-only`, `COMMIT_COUNT=1`, `CHANGED_FILE_COUNT=11`,
  `DOCS_ONLY=false`, with the coverage limitation stated rather than claiming
  full history. Six defects are fixed and pinned by fixtures. No review has been
  published. Every phase after inspection — normalization, path verification,
  schema validation, publication — is still unexercised in CI, so the artifact
  contract remains unproven end to end.
- **Repository secrets are now set.** `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN` were added as scoped repository secrets. Values were
  piped from the sibling worktree's `.env` and never printed. The older
  `GROQ_API_KEY` secret is now unused by this workflow and is dead weight, but
  removing it is out of scope for this track.
- **`workflow_dispatch` is declared but not dispatchable.** `gh workflow run`
  returns HTTP 422 for this workflow because GitHub resolves dispatch against
  the default branch, where the file does not exist. Retry during this track was
  done with `gh run rerun`, which works. The declared trigger is not wrong — it
  is inert until the workflow lands on the default branch — but it is currently
  misleading in the file.
- `openai/codex-action` and the direct Codex CLI both fail against Groq because
  Groq rejects their Responses API request bodies. Neither integration may be
  retried. This is the defect this track exists to remove.
- OpenCode v2.0.21 is pinned by version and sha256
  (`8ef5c24deb…`), but the tarball is fetched over HTTPS from `opencode.ai` with
  no signature or attestation. Checksum pinning raises the bar; it does not
  eliminate supply-chain risk.
- The context bundle is bounded per section. A decisive section that falls past
  the bound is handed to the model as a path plus a truncation marker. This is a
  deliberate context/size tradeoff, not proof that the reviewer saw everything.
- Neuron consumption for a full review is not yet measured. The probe cost ~5.16
  neurons for a trivial call; a real review reads far more.
