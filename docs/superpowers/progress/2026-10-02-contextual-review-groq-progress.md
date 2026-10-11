# Contextual Review (OpenCode + Groq) — Progress

<!-- agent-track: id=contextual-review-groq; status=ACTIVE; branch=feat/contextual-review-groq; integration=feat/preference-first-selection; base=1ceb477de44b3589cbc01b13eac9bf7aa22c98da; plan=docs/superpowers/plans/2026-10-02-contextual-review-groq-plan.md -->

## Current execution verdict

**Both questions are now answered, and they have different answers. Pipeline
acceptance is met. Product-review quality is demonstrated but not flawless.**

The reviewer published a canonical `CHANGES REQUIRED` /
`ARCHITECTURE_DRIFT_WARNING` review with `commit_id` equal to
`4f2c87b52711274184849d55d1766b32bee431fe`, produced through inspection,
normalization, finding-path verification, schema validation, and publication on
the incremental range `scripts/agent-review-baseline` selected
(`f6d8f6e4...`, `latest-commit-only`, 1 commit). It found three real defects in
this track's own governance code.

Product-review quality: a bounded historical calibration against the real
Preference-First IdentityVerifier returned `CHANGES_REQUIRED` /
`ARCHITECTURE_DRIFT_WARNING` with 3 findings over 20 observed read tool calls.
I verified them independently: two held exactly, and the third was substantively
correct but carried a **wrong line anchor** (the assertion is at live-spec line
177, not 145–146). That is the honest shape of the result: the reviewer
demonstrably reasons about product code and reaches sound conclusions, but its
citations are not yet reliable enough to be treated as self-verifying.

A second calibration on the Overture commit could not complete. The free-tier
daily allowance for the pinned free model was exhausted and the attempt is
recorded as `INCOMPLETE` with no verdict, which is itself correct fail-closed
behavior under a real provider wall.

Scope remains bounded to replacing the failed inference harness in
`.github/workflows/zig-zag-contextual-review.yml`. The existing workflow
contract, the review artifact contract, and the JSON schema are preserved and
unchanged. The artifact contract, the canonical prompt authority, and the
canonical North Star remain the single authorities; no parallel registry was
introduced.

No production behavior is in scope. RW4 code is untouched. Neither PR #72 nor
PR #71 is merged.

## Current checkpoint

**Both acceptance questions are answered. The track's bounded work is complete
and awaits a human decision; no further review execution is authorized.**

### Provider decision: OpenRouter + Qwen3.8 27B Free

Groq was rejected because OpenCode's intrinsic request size exceeds the free-tier
input-token-per-minute limit. Cloudflare Workers AI connected and executed
repository tools but exhausted a 10,000-neuron daily free allocation across the
probe and three CI attempts. The human owner authorized exactly one further
bounded substitution to `openrouter/qwen/qwen3.8-27b:free`, which then published
a real review. The substitution budget is now exhausted: no third substitution
and no paid endpoint are authorized. This decision is recorded in the canonical
plan, which previously still asserted a Cloudflare-only clause; the plan now
carries an explicit SUPERSEDED provider decision rather than leaving plan
authority to drift into progress prose.

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
empty-visible-content guard added to the inspection phase makes the review fail
closed regardless of whether reasoning control reaches the wire. This
uncertainty is
recorded rather than resolved; further investigation is not authorized and is not
required for the review to run.

### Empty-response hardening

A successful HTTP response with no visible body is not a review. The inspection
phase rejects a whitespace-only response explicitly, in addition to the existing
non-empty check, so reasoning that consumes the entire output budget cannot be
normalized into an empty-but-valid review.

The normalization phase does **not** carry a separate whitespace guard, and the
earlier claim that it did was wrong. `review.json` is the output of
`sed -n '/^{/,/^}/p'`, so it is either empty or begins with `{`; whitespace-only
content is unreachable there. Its real emptiness guards are the no-JSON and
invalid-JSON checks that immediately precede it. The dead guard was removed rather
than relocated, and the governance assertion that counted "two" such guards was
replaced with per-phase assertions, matching the convention already used for the
provider-error diagnostics in the same spec.

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
scripts/agent-review-baseline.spec.sh   18 fixtures PASS, exit 0
scripts/agent-governance.spec.sh        64 assertions PASS, exit 0
shellcheck (5 governance + review scripts, 2 specs)   clean, exit 0
ruby YAML parse, 8 workflows                valid, exit 0
ajv draft2020, schema-conformant JSON         valid, exit 0
ajv draft2020, schema-violating JSON         rejected, exit 1
```

These counts are measured, not carried forward. An earlier revision of this block
claimed 19 baseline fixtures and 59 governance assertions; neither matched the
suite at any commit — the baseline spec has 18 fixture assertions, and the
governance spec stood at 59 before this checkpoint added its five. The block was
corrected here rather than left describing a checkpoint it did not cover.

The canonical schema, artifact contract, and original prompt authority are
unchanged; the two new phase prompts are additive and neither emits a verdict
during inspection.

No production behavior was touched. RW4 code is untouched.

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

### Historical product calibration — IdentityVerifier (completed)

The remaining question — can the reviewer reason about the real Preference-First
tour engine, not just this track's governance YAML? — was answered by one
bounded calibration over the declared historical range
`1842004715930ea2cc2f27aed0ff483d90888ec7..15af1ccb641122d633de4c5f1fd853d963ba0a18`.
The report is
`docs/superpowers/reports/2026-10-03-historical-product-calibration-identityverifier/`.

It is explicitly **not** a canonical review of PR #71. It carries no `CURRENT`
marker, binds no PR, and is labeled a historical product calibration in its own
title. Isolation was by `git archive` export rather than `git worktree add`,
because registering another worktree would have altered `agent-track`
discovery semantics for the Preference-First track. Post-run isolation was
re-verified: the Preference-First head, its worktree, PR #71's empty review
list, the worktree count, and PR #72's single review were all unchanged.

Result: **`CHANGES_REQUIRED` / `ARCHITECTURE_DRIFT_WARNING`, 3 findings**, with
20 observed read tool calls and the evidence gate satisfied.

I verified the findings myself rather than accepting them, and two of three
held while the third was partly wrong:

- F1 confirmed at `identity-verifier.service.ts:91-107` and `:144-145`.
- F2 confirmed: `run.sh` writes `db-after-probe.json` while the committed
  artifacts are `.pre-fix/.post-fix.json`.
- F3's substance is real but its **line anchor is wrong**. The assertion the
  finding targets is at live-spec line **177**, not 145–146. The reviewer
  reached the right conclusion with a bad citation, so its verdict stands while
  the citation does not. Treat the anchor error as measured reviewer
  imprecision, not a defect in the reviewed code.

### Historical product calibration — Overture (incomplete)

A second calibration on `f39101726f9abca012575cc47b2102d43b6c9c18` was attempted
and is recorded as **INCOMPLETE with no verdict** in
`docs/superpowers/reports/2026-10-03-historical-product-calibration-overture-incomplete/`.
The transcript proves a real, bounded attempt — 21 read and 17 grep calls across
16 paths, reading the changed files, the module, downstream consumers, the
canonical engineering principles, and the live spec — before a
`provider.internal` network loss and then a `free-models-per-day` 429 ended it.
Zero `text` events were emitted, so no evidence existed to normalize. Deriving a
verdict from that transcript would mean inventing one, and the harness correctly
reported `INCOMPLETE` instead. The attempt was abandoned rather than retried
with credits, because paid fallback and provider substitution are forbidden.

## Next authorized action

**Stop. Both acceptance questions are answered and no further review execution
is authorized. The remaining step belongs to the human owner: decide the
integration of PR #72.**

What is settled, as two independent conclusions:

- **Pipeline acceptance: met.** The published review on PR #72 binds
  `commit_id` to the exact reviewed HEAD `4f2c87b5...` and reached publication
  through inspection, normalization, finding-path verification, schema
  validation, and publication on the incremental range
  `scripts/agent-review-baseline` selected.
- **Product-review quality: demonstrated, with a measured limit.** The
  IdentityVerifier calibration produced a sound verdict and 3 findings, 2 of
  which I confirmed exactly and 1 of which is substantively right but cites the
  wrong line. The reviewer reasons about product code; its line citations are
  not yet dependable enough to skip human verification.

Three commits are prepared and local only; none is pushed. A human must decide
whether to push, request review, or close. Nothing further should be pushed or
merged by an agent without that decision.

Still unauthorized: do not merge PR #72 or PR #71, do not implement
`zig-zag-track-start`, do not wire an automatic fix/commit/push/merge loop, do
not substitute another provider, and do not retry the Overture calibration with
paid credits.

## Open findings / blockers

- **Pipeline acceptance is met; product-review quality is demonstrated but
  imperfect.** The reviewer's published review proves the artifact contract end
  to end: inspection, normalization, finding-path verification, schema
  validation, and publication all worked on real model output, and the review
  binds to the exact reviewed HEAD. Its three findings were genuine defects in
  this track's own files. The IdentityVerifier calibration then showed the
  reviewer does judge real product architecture, with the citation caveat
  recorded below.
- **The reviewer cited the wrong line for one calibration finding.** The
  IdentityVerifier calibration's F3 substance is correct — the assertion it
  targets exists — but the anchor is wrong: the live assertion is at line **177**,
  not 145–146. I confirmed this by reading the file rather than trusting the
  report. Two of the three findings cited lines that were exact. Treat reviewer
  line citations as a lead to verify, not as proof, and do not let a correct
  verdict launder a wrong citation in a published canonical review.
- **The reviewer cannot execute anything, so its test and CI claims are
  author-reported.** The inspection agent is read-only: it runs no test, no
  shellcheck, no YAML parse, no `ajv`, no `git`, and no provider call. Every
  verification claim in a review — including the ones in this document when
  written by the reviewer — is unverified. Deterministic gates remain the only
  source of truth for whether code actually passes.
- **The free OpenRouter tier is a real availability dependency of the canonical
  pipeline, not a local inconvenience.** The second calibration died on
  `free-models-per-day` after a transient `provider.internal` network loss. In
  CI the same wall produces `REVIEW UNAVAILABLE / FAILED` with zero published
  reviews, which is correct fail-closed behavior but means a review can be
  unavailable purely on quota. This is the same class of wall as the earlier
  Cloudflare 10,000-neuron stop, and it is now the pipeline's standing
  operational risk. No paid fallback is authorized by the plan.
- **Calibration cannot validate the canonical review schema, by
  construction.** The schema requires `pr_number` and `base_branch`, which exist
  only for a live pull request. The model substituted `baseline`/`range` keys,
  which `additionalProperties: false` correctly rejects. In calibration this is
  expected; against a live PR it means the pipeline would refuse to publish,
  which is the correct outcome rather than a schema weakness.
- **`scripts/agent-review-calibration --reuse` no longer records a false
  `inspect_exit` (corrected).** Reuse previously forced `inspect_status=0`, so a
  transcript captured from a failed run was re-reported as a clean inspection.
  Reuse now derives the status from the transcript's own provider error events.
  Verified against the real truncated Overture transcript, which now derives
  `1`, and against a clean transcript, which derives `0`. The empty-evidence
  branch still fails closed, so this path could never manufacture a verdict
  either way.
- **Insufficient evidence could previously become a canonical PASS.** The
  normalizer prompt instructed it to return `findings: []` plus `PASS` when the
  evidence was "empty or unusable", and the published invariant already accepts
  `PASS` with zero findings. A truncated or hallucinated inspection report could
  therefore have become a clean, permanently recorded, canonical PASS that
  asserted the delta was correct. This was fail-open, not merely weakly worded.
  It is now enforced deterministically by `scripts/agent-review-evidence-gate`:
  evidence with no usable `INSPECTED PATHS` record fails closed whatever the
  verdict, and a `PASS` additionally requires that the inspected paths cover at
  least one path the reviewed range actually changed. The prompt states the same
  rule so the model does not waste a request that will be discarded. Regression
  cases cover non-covering evidence, an empty record, a missing section, and an
  unrecognized verdict. These tests are not vacuous: they caught a real ordering
  bug in the first version of the gate, where an unknown verdict exited through
  the non-`PASS` branch before it was validated.
- **Canonical North Star discovery was silently dead.** `scripts/agent-review-context`
  extracted the roadmap path the authority index declares, but tested it relative
  to the repository root while the index declares it relative to
  `docs/superpowers/`. The existence test could never succeed, so the hardcoded
  filename was always used and a changed canonical declaration was ignored with no
  signal. The index is still the single authority — no second North Star registry
  was added. Discovery now resolves against the authority directory, prefers the
  row the index labels canonical, and fails explicitly when the declaration is
  unresolvable rather than falling back. A regression case changes the declared
  canonical roadmap and asserts the new file is the one consulted.
- **The Cloudflare quota wall is historical, not current.** Cloudflare was
  exhausted at 10,000 neurons/day (HTTP 429, code 4006) across the probe plus
  three CI attempts, and the provider has since been replaced by OpenRouter. One
  diagnostic lesson is retained: the workflow *hid* that reason, because OpenCode
  emits provider errors on stdout while the step only tailed stderr. Both model
  phases now surface the provider error object, and a governance assertion
  enforces it.
- **Live GitHub Actions execution had failed five times before it succeeded.**
  Runs on `c3002986` and `56f16332` exited 2 on shell defects in the range and
  prepare steps; run 37095103080 attempt 1 failed closed on absent credentials,
  correctly; attempt 2 reached the reviewer and failed because OpenCode refuses
  to read `RUNNER_TEMP`; runs 37095891616 and 37096256787 failed on the exhausted
  provider allocation. The range logic behaved correctly every time:
  `COVERAGE=latest-commit-only`, `COMMIT_COUNT=1`, `CHANGED_FILE_COUNT=11`,
  `DOCS_ONLY=false`, with the coverage limitation stated rather than claiming
  full history. Seven defects are fixed and pinned by fixtures. The subsequent
  run published a real review rather than failing closed.
- **The five earlier failures still established the deterministic contract.** The
  deterministic half of the
  pipeline is genuinely proven against real CI: HEAD resolution, trusted-repo
  checks, track identity, integration-target validation, incremental baseline
  selection, context assembly, provider-config gating, and the
  checkout-integrity and fail-closed guards. Five independent failure paths each
  produced `REVIEW UNAVAILABLE / FAILED`, zero reviews, and no synthesized
  `PASS`. That contract holds under real failure, not only under fixtures.
- **The model-driven middle is no longer the open question.** It previously had
  fixtures proving its *guards* fire on bad input, which is not the
  same as proving it *passes* on good input. The published review closes that
  gap: real model output normalized into the canonical schema, passed
  finding-path verification and ajv, and published. Whether the reviewer's
  conclusions are *correct* on product code is an independent question from
  whether the pipeline executed correctly; the IdentityVerifier calibration
  answers it as "mostly yes, with imprecise citations".
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
