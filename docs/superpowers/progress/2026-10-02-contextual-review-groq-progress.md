# Contextual Review (OpenCode + Groq) — Progress

<!-- agent-track: id=contextual-review-groq; status=ACTIVE; branch=feat/contextual-review-groq; integration=feat/preference-first-selection; base=1ceb477de44b3589cbc01b13eac9bf7aa22c98da; plan=docs/superpowers/plans/2026-10-02-contextual-review-groq-plan.md -->

## Current execution verdict

**Provider switched to OpenRouter under one bounded substitution. The minimal
live probe passed all seven acceptance criteria; the full pipeline has still
never completed a review. No review published.**

Seven implementation defects were found and fixed, two of them shipped by me and
found by CI. Cloudflare is exhausted and is no longer the provider; the current
provider is OpenRouter's explicitly free endpoint.

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

**OpenRouter probe passed. Acceptance awaits one CI run that publishes.**

### Provider decision: OpenRouter + Qwen3.8 27B Free

Groq was rejected because OpenCode's intrinsic request size exceeds the free-tier
input-token-per-minute limit. Cloudflare Workers AI connected and executed
repository tools but exhausted a 10,000-neuron daily free allocation across the
probe and three CI attempts. The human owner authorized exactly one bounded
substitution to `openrouter/qwen/qwen3.8-27b:free`. No second substitution and no
paid endpoint are authorized.

The `:free` suffix is now enforced, not merely configured. Both model-driven
phases assert that `REVIEW_MODEL` ends in `:free` and fail closed otherwise, so a
misconfigured identifier cannot silently bill the paid sibling
`qwen/qwen3.8-27b`, which exists in the catalog as a distinct entry. There is no
automatic fallback to any other provider. A governance assertion rejects any
`CLOUDFLARE`, `cloudflare`, `workers-ai`, `GROQ`, or `groq` reference remaining in
the workflow, so a retired provider cannot linger as a dead credential or an
accidental paid path.

### Minimal live probe — verified conclusions only

Run once against `openrouter/qwen/qwen3.8-27b:free` with the pinned OpenCode
2.0.21 and the existing read-only `reviewer` agent:

1. The provider accepted the request; exit 0 with no error events.
2. OpenCode executed a real repository `read` tool call, state `completed`.
3. The model received the result and quoted the requested lines byte-exactly,
   including an adjacent line it was not asked about, which is difficult to
   produce without having read the file.
4. The response carried visible, evidence-backed text.
5. `HEAD` was unchanged and the only modified tracked paths were this track's
   own uncommitted edits. This is weaker than it sounds: file modification times
   are not proof of content integrity, so it is recorded as suggestive rather
   than proven. The CI run no longer relies on it (see below).
6. The tested endpoint was explicitly `:free`, confirmed present in the
   models.dev catalog as `qwen/qwen3.8-27b:free`.
7. No paid usage was reported. One request, roughly 17k input and 67 output
   tokens, on a free endpoint, with no fallback attempted.

**Not proven: that `reasoning.effort: none` is transmitted to OpenRouter.** The
probe still reported 182 reasoning tokens with the setting in the agent
frontmatter. A control comparison was attempted and was inconclusive, because
tool-free runs returned no `step_finish` event to compare token counts against.
What is established is behavioral, not mechanistic: the agent configured with
`effort: none` produces visible output, which is the property the pipeline
actually depends on. The documented OpenRouter semantics — reasoning tokens
counting against the same output budget as visible content — explain the earlier
empty-response failure, and OpenCode sets no comparable output cap. The
empty-visible-content guards added to both phases make the review fail closed
regardless of whether reasoning control reaches the wire. This uncertainty is
recorded rather than resolved; further investigation is not authorized and is not
required for the review to run.

### Empty-response hardening

A successful HTTP response with no visible body is not a review. Both phases now
reject a whitespace-only response explicitly, in addition to the existing
non-empty and valid-JSON checks, so reasoning that consumes the entire output
budget cannot be normalized into an empty-but-valid review.

### Deterministic checkout integrity

The previous integrity guard used `git status --porcelain --untracked-files=no`.
That answers from the index's stat cache rather than from file content, so it is
not proof that the reviewer left the checkout alone, and the probe's evidence
rested on modification times. Both model-driven phases now hash the tracked
working tree with `git write-tree` through a private `GIT_INDEX_FILE` and compare
the object id before and after the model call.

`git add -u` records only already-tracked paths, so the untracked `.review-input`
staging directory cannot mask a change or fake one, and the reviewer's own index
is never touched. The guard was exercised against four scenarios: a tracked
modification, a tracked deletion, an untracked file, and a clean run. The first
two changed the hash; the latter two did not. Four deliberate regressions were
then injected into the workflow to confirm the fixture is not vacuous —
reverting to `git status`, widening to `git add -A`, dropping the normalization
phase comparison, and removing the private index — and each was detected.

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

**Defect 7 — the workflow hid the provider's own error.** Run 37095891616
reported `OpenCode inspection exited 1` with a completely empty stderr, which
sent me looking for a code defect that did not exist. OpenCode emits provider
failures as a JSON `error` event on stdout; the step only tailed stderr. Both
model phases now print the provider error object before failing, and the
governance spec asserts both sites, so a future quota or auth failure is
readable from the run log instead of requiring local reproduction.

**Defect 7's fix is verified in CI.** Run 37096256787 on `594a32a8` failed
inspection and the run log now states the cause directly, with no local
reproduction needed:

```text
REVIEW UNAVAILABLE / FAILED: OpenCode inspection exited 1
{"type":"provider.rate-limit","message":"AiError: AiError: you have used up your
 daily free allocation of 10,000 neurons, ... (a87ced56-...)"}
```

PR #72 carried zero reviews afterward. So the diagnostic fix is confirmed against
real CI, and the fail-closed contract is confirmed for the fifth consecutive
run. This run consumed no neurons: the allocation check rejects before inference.

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

**HALTED — provider daily allocation exhausted.** After the staging fix, run
37095891616 again failed in inspection with no diagnostic at all: the step
reported `OpenCode inspection exited 1` and an empty stderr. Reproducing locally
against the same provider revealed the cause, which the workflow had been
hiding:

```text
provider.rate-limit (HTTP 429, Cloudflare code 4006)
you have used up your daily free allocation of 10,000 neurons,
please upgrade to Cloudflare's Workers Paid plan
```

OpenCode reports this as a JSON `error` event on **stdout**, not stderr. The step
only tailed stderr, so the actual reason was invisible in CI and I spent a cycle
chasing an imaginary code defect. Both model phases now surface the provider's
own error object before failing, and a governance assertion requires that in
both places.

The substantive position, stated plainly: **the reviewer has still never
completed a single review against a live model.** The probe proved the provider
accepts an oversized request and executes read tools, but it was a trivial
two-file probe, not this pipeline. The free tier allows 10,000 neurons per day
and the probe plus three failed CI attempts consumed it. There is no remaining
budget to complete acceptance today.

This is the same class of wall as the original Groq quota stop: a real,
demonstrated provider limit, not a design gap. The pipeline's shell, range
selection, context assembly, and fail-closed behavior are all verified. What is
unverified is the model-driven middle of the pipeline — inspection evidence,
normalization into the schema, path verification, and publication.

I am stopping here rather than pushing again. Pushing would consume CI minutes
to produce a fourth identical rate-limit failure, and the plan authorizes no
further provider substitution and no paid upgrade.

## Next authorized action

**Run the one bounded CI acceptance execution for the OpenRouter provider and
report the result, including a failure if that is what happens.**

The pipeline is committed and the credential is configured. Do not start a
fix/retry cycle if it fails, and do not substitute another provider: report the
failing stage and its sanitized error instead.

Acceptance criteria: a published review on PR #72 whose `commit_id` equals the
exact reviewed HEAD, produced through inspection, normalization, path
verification, schema validation, and publication on the incremental range
`scripts/agent-review-baseline` selected.

Do not add a second provider, do not wire an automatic fix/commit/push/merge
loop, and do not merge PR #72.

## Open findings / blockers

- **The Cloudflare quota wall is historical, not current.** Cloudflare was
  exhausted at 10,000 neurons/day (HTTP 429, code 4006) across the probe plus
  three CI attempts, and the provider has since been replaced by OpenRouter. One
  diagnostic lesson is retained: the workflow *hid* that reason, because OpenCode
  emits provider errors on stdout while the step only tailed stderr. Both model
  phases now surface the provider error object, and a governance assertion
  enforces it. This matters for the pending run — a quota or auth failure on
  OpenRouter will be visible rather than silent.
- **The reviewer has never completed a single live review.** The probe proved
  the provider accepts an oversized request and executes read tools, but not
  this pipeline. Normalization into the canonical schema, finding-path
  verification, ajv validation, and publication are all unexercised against real
  model output. Fixture coverage proves the guards fire; it does not prove the
  happy path works. A successful probe is not acceptance, and neither is a green
  fixture suite.
- **Live GitHub Actions execution has failed five times and is not yet proven.**
  Runs on `c3002986` and `56f16332` exited 2 on shell defects in the range and
  prepare steps; run 37095103080 attempt 1 failed closed on absent credentials,
  correctly; attempt 2 reached the reviewer and failed because OpenCode refuses
  to read `RUNNER_TEMP`; runs 37095891616 and 37096256787 failed on the exhausted
  provider allocation. The range logic behaved correctly every time:
  `COVERAGE=latest-commit-only`, `COMMIT_COUNT=1`, `CHANGED_FILE_COUNT=11`,
  `DOCS_ONLY=false`, with the coverage limitation stated rather than claiming
  full history. Seven defects are fixed and pinned by fixtures. No review has
  been published. Every phase after inspection is still unexercised in CI, so
  the artifact contract remains unproven end to end.
- **What the five failures did establish.** The deterministic half of the
  pipeline is genuinely proven against real CI: HEAD resolution, trusted-repo
  checks, track identity, integration-target validation, incremental baseline
  selection, context assembly, provider-config gating, and the
  checkout-integrity and fail-closed guards. Five independent failure paths each
  produced `REVIEW UNAVAILABLE / FAILED`, zero reviews, and no synthesized
  `PASS`. That contract holds under real failure, not only under fixtures.
- **What remains unproven is narrower than it looks.** Only the model-driven
  middle: that inspection emits usable evidence, and that normalization,
  finding-path verification, schema validation, and publication work on real
  model output. Those phases have fixtures proving their *guards* fire on bad
  input, which is not the same as proving they *pass* on good input.
- **Repository secrets are now set.** `OPENROUTER_API_KEY` is configured as a
  scoped repository secret and its value has never been printed, committed, or
  written to a workflow artifact. The local probe read the key from a git-ignored
  `.env.openrouter` in this worktree only; the tracked tree never contained it.
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `GROQ_API_KEY` remain in
  the repository but are no longer referenced by this workflow. Removing them is
  out of scope for this track.
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
- **The `:free` suffix is enforced but not independently verified upstream.**
  Both phases assert it before issuing a request, which prevents this workflow
  from selecting a paid identifier. It does not prove OpenRouter honored the free
  tier for a given request; only OpenRouter's own accounting can show that, and
  this run does not query it. No paid usage was reported during the probe.
- **Reasoning control is behavioral, not mechanistic.** See the checkpoint
  section: the agent configured with `effort: none` produces visible output, but
  the setting was not observed on the wire and 182 reasoning tokens still
  appeared. This is the one place where a review could plausibly return an empty
  body despite a successful response; both phases now reject that explicitly.
- **The probe's checkout integrity evidence was weak and is superseded.** It
  relied on modification times, which a restore can reproduce. Both CI phases now
  compare a content hash of the tracked tree instead.
