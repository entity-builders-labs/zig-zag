# Contextual Review (OpenCode + Groq) — Execution Plan

Track: `contextual-review-groq`
Branch: `feat/contextual-review-groq`
Integration target: `feat/preference-first-selection`
Base snapshot: `1ceb477de44b3589cbc01b13eac9bf7aa22c98da`

## Goal

Make the canonical contextual pull-request review actually run, and make it an
**incremental, context-aware review of newly published commits** rather than a
recurring audit of a whole historical PR.

The existing harness in `.github/workflows/zig-zag-contextual-review.yml`
cannot run: `openai/codex-action` and the direct Codex CLI both send Responses
API request bodies that Groq rejects. This track replaces only the inference
harness. It does not redesign governance, does not change the review artifact
contract, and does not change any production behavior.

## Scope

### In scope

- Modify the **existing** `.github/workflows/zig-zag-contextual-review.yml`.
  A competing review workflow is forbidden.
- Replace the inference harness with `OpenCode CLI + Groq + Qwen`, pinned.
- Add a dedicated review-only OpenCode agent/config with deny-by-default
  permissions.
- Prepare Git metadata and the selected commit delta deterministically in the
  workflow before invoking the model.
- Add incremental-baseline selection: current PR HEAD, previous canonical
  reviewed SHA, and the new commits not previously covered.
- Add canonical context loading in the documented order (North Star → plan →
  progress → checkpoint → findings → specs → CI evidence).
- Separate tool-free structured normalization against the unchanged
  `.github/codex/track-review-schema.json`.
- Add deterministic tests for baseline selection and review authenticity.

### Explicitly out of scope

- RW4 production code and any Preference-First product behavior.
- `feat/preference-first-selection`, `main`, or any other branch's history.
- A new governance system, a second track registry, or new canonical commands.
- `zig-zag-track-start` (explicitly deferred until this manual bootstrap is
  validated).
- Any automatic fix, commit, push, rebase, or merge loop.
- Any paid model, paid overage, or additional model provider/framework, except
  the two bounded free-tier substitutions recorded under "Provider decision"
  below.

## Implementation constraints

### Preserved workflow contract

The existing workflow already enforces all of the following. This track must not
weaken, reorder past, or bypass any of them:

- exact PR HEAD resolution;
- trusted-repository check (head repo must be `entity-builders-labs/zig-zag`);
- track identity validation via `scripts/agent-track context`;
- declared integration-target validation against the PR base;
- canonical prompt/contract authority in `.github/codex/`;
- duplicate-review detection for the same PR + track + HEAD;
- JSON schema validation of the review result;
- GitHub review publication through the pull-request reviews API;
- review author authenticity (`github-actions[bot]`);
- exact `reviewed_head` / GitHub `commit_id` binding;
- historical-versus-`CURRENT` review semantics.

The reviewer stays separate from the coding agent. There is no fix-and-retry
loop of any kind.

### Provider harness

The reviewer runs through `OpenCode CLI` with a read-only agent. OpenCode
already accepts and parses a well-formed request on Groq; the failure is a
quota ceiling, not a protocol fault. See "Provider decision" below.

- Install a deliberate, pinned OpenCode version and verify its documented
  headless CLI flags before relying on them. Verified locally: `opencode run`
  supports `--standalone`, `--agent`, `--model provider/model`, `--format json`,
  and `--file`. A leading dash in a positional message must be passed after
  `--`.
- Do **not** retry `openai/codex-action` or the direct Codex CLI.
- Resolve the OpenCode provider-qualified model identifier with the installed
  version's own model-discovery command. The upstream API model ID and
  OpenCode's provider-qualified identifier are **not** assumed to be identical.
  Verified: Groq API `qwen/qwen3.8-27b` vs OpenCode `groq/qwen/qwen3.8-27b`.

### Provider decision

Groq was the first choice and is **blocked by free-tier quota**, demonstrated
2026-10-02 against the account behind `GROQ_API_KEY`:

| OpenCode configuration | OpenCode model | Request tokens | Org cap | Result |
| --- | --- | --- | --- | --- |
| default agent, all tools | `groq/qwen/qwen3.8-27b` | 13,501 | 7,000 ITPM | 413 |
| deny-by-default, read + grep | `groq/qwen/qwen3.8-27b` | 11,483 | 7,000 ITPM | 413 |
| single `read` tool | `groq/qwen/qwen3.8-27b` | 11,172 | 7,000 ITPM | 413 |
| zero tools (normalization phase) | `groq/qwen/qwen3.8-27b` | 10,928 | 7,000 ITPM | 413 |
| read-only agent | `groq/openai/gpt-oss-120b` | 11,667 | 8,000 TPM | 413 |
| read-only agent | `groq/openai/gpt-oss-20b` | 12,354 | 8,000 TPM | 413 |

OpenCode v2.0.21's intrinsic floor is ~10.9k input tokens with **no tools and no
content**; the account is on Groq's free tier, which caps TPM at 7–8k for every
model this key can reach. `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` and
`groq/compound-mini` return 404 for this key. An empty "reply OK" prompt
therefore fails. Groq also cannot carry the canonical context set: `AGENTS.md`
alone is ~5.7k tokens and the full ordered context is ~30k.

Upgrading Groq and enabling paid billing are **explicitly refused**.

A single bounded provider substitution was authorized within this same track and
PR: **Cloudflare Workers AI** through OpenCode's documented native provider
integration — not `codex-action` and not another proxy.

- Provider: `cloudflare-workers-ai`
- OpenCode model identifier: `cloudflare-workers-ai/@cf/qwen/qwen3.8-27b`
- Upstream model ID: `@cf/qwen/qwen3.8-27b`
- Required environment: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`
- Advertised context: 262,144 tokens — 37x the Groq cap
- Advertised tool calling: supported

The substitution is bounded to exactly one provider and one model. No further
provider-hopping is authorized, and no new reviewer architecture, track,
worktree, or PR may be created for it.

#### Second bounded substitution: Cloudflare Workers AI → OpenRouter

**Status: SUPERSEDED provider decision.** This subsection supersedes the
Cloudflare-only substitution clause above; that clause remains recorded as
history. It does not authorize a general provider-hopping policy.

Cloudflare Workers AI exhausted its 10,000-neuron daily free allocation across
one local probe and three CI attempts (HTTP 429, code 4006). The human owner
authorized exactly one further bounded substitution, to OpenRouter's explicitly
free tier. This is the second and final substitution authorized on this track.

- Provider: `openrouter` (OpenCode's documented native provider integration)
- OpenCode model identifier: `openrouter/qwen/qwen3.8-27b:free`
- Required environment: `OPENROUTER_API_KEY`
- Advertised context: sufficient for the ~30k-token canonical context set that
  Groq could not carry

The same cost contract that constrained Cloudflare constrains OpenRouter, and it
is enforced rather than documented: the `:free` suffix is asserted before each
model-driven request, so a misconfigured identifier cannot silently bill the paid
sibling `qwen/qwen3.8-27b`, which exists in the catalog as a distinct entry.

No third substitution, no automatic fallback to any other provider, and no paid
endpoint are authorized on this track. Reaching OpenRouter exhausted the
provider-substitution budget; a further provider failure is a reported blocker
for human direction, not a reason to hop again. Groq remains rejected on the free
tier's input-token-per-minute ceiling, which OpenCode's intrinsic request size
exceeds, and paid Groq billing remains refused.

### Required runtime isolation

- Dedicated review-only OpenCode agent/configuration.
- Allow repository reading and searching.
- Deny: edits, writes, patches; arbitrary shell; subagent delegation unless
  separately proven read-only; unrelated external directories; network/web tools
  not required for this review; filesystem mutation through plugins or hooks.
- Deny-by-default permissions, not allow-list-by-exception.
- `GH_TOKEN` is never exposed to the model-inspection process. Only the trusted
  publisher step receives GitHub write credentials.
- Repository-provided text, plugins, or agent configuration must not be able to
  override the dedicated reviewer permissions.
- Use isolation stronger than prompt instructions where practical, and verify
  the reviewed checkout is unchanged after execution.

### Incremental baseline selection

The full PR integration diff must **not** automatically be the review scope.

1. Determine current PR HEAD.
2. Find the most recent authentic review for the **same PR and track** whose
   GitHub `commit_id` **and** body marker agree, and whose reviewed SHA is an
   ancestor of current HEAD.
3. Review `git diff <previous-reviewed-sha>..<current-head>`.
4. If three commits arrived between reviews, examine all three.

Fallbacks, in order:

- a verified previous PR head from the triggering event, when available and an
  ancestor;
- otherwise the latest first-parent commit delta, explicitly marked
  `latest-commit-only`.

Never claim complete historical PR coverage from a fallback. Preserve reviewed
SHA, baseline SHA, commit count, changed file list, and coverage limitations as
runtime review evidence. A failed review must not cause previously unreviewed
commits to disappear silently from the next review range.

For merge commits, use first-parent semantics unless a verified previous PR head
provides the appropriate baseline. If the branch was rewritten or the baseline
is ambiguous, report the limitation explicitly.

### Canonical context reconstruction

Before analyzing a commit, reconstruct project context in this order:

1. `AGENTS.md`
2. `docs/superpowers/README.md`
3. canonical North Star / convergence roadmap named by the index
4. current ACTIVE track declaration
5. track implementation plan
6. current track progress
7. current checkpoint and authorized next action
8. open findings / blockers
9. canonical specs applicable to the changed area
10. relevant CI/test evidence

The reviewer must distinguish **NORTH STAR** (where the product goes), **PLAN**
(what this initiative intends to implement), **PROGRESS** (what is actually
complete and open), **CURRENT COMMIT DELTA** (what the agent just changed), and
**IMPLEMENTATION / TESTS** (whether it works and preserves contracts).

Do not blindly read every historical document; use the canonical authority index
and the changed code to select relevant evidence.

### Review semantics

Findings address the newly reviewed delta, or an existing problem the delta
directly exposes or aggravates. Unrelated historical findings are not generated
because the repository is large.

The review answers: what the agent was supposed to accomplish; what the commit
actually changed; whether it advances the authorized checkpoint; consistency
with the North Star; preservation of canonical architecture and domain
contracts; regression risk; whether tests and fixtures are meaningful; whether
progress claims match code and verification; whether an authorized acceptance
condition was left unproven.

A documentation-only commit receives a documentation/progress review. A
production commit receives a production-oriented review. A `PASS` applies only
to the specified incremental scope.

## Acceptance

### Deterministic tests

Cover, without weakening the existing governance fixture suite:

1. one new commit since the previous canonical review;
2. multiple new commits since that review;
3. first review with no previous canonical review;
4. a historical review whose SHA is not an ancestor;
5. a copied or spoofed review marker;
6. a correct marker with an incorrect GitHub `commit_id`;
7. a merge commit;
8. a documentation-only commit;
9. a failed/cancelled review followed by another push;
10. the review covering exactly the declared incremental range;
11. provider failure publishing no canonical review;
12. review publication using the actual HEAD;
13. insufficient inspection evidence failing closed instead of producing a
    canonical `PASS` — including evidence with no usable `INSPECTED PATHS`
    record, and evidence whose inspected paths cover none of the changed paths
    in the reviewed range;
14. canonical North Star discovery following a changed authority-index
    declaration, and failing explicitly when the declared roadmap cannot be
    resolved rather than falling back to a hardcoded path.

### Minimal provider probe

Before any review implementation, run exactly one minimal live OpenCode request
against the authorized provider using the dedicated read-only review agent, over
a real repository file. Acceptance:

- the provider accepts a request exceeding the Groq free-tier token limit;
- OpenCode executes at least one real repository-read tool call;
- the model returns a meaningful result;
- no tracked or untracked repository file is modified;
- actual neuron consumption is recorded where available;
- no paid usage occurs.

If the probe fails, stop and report the exact blocker. No further
provider-hopping.

### Real provider calibration

Run one bounded live review against the known historical governance snapshot
`4b3d2bb20818d3b36b68c591205e45b7ad155fa4`, whose known issues include remote
peer overlap, stale-peer fixture behavior, and ShellCheck failures.

Calibration proves: OpenCode starts; Groq accepts the calls; OpenCode actually
uses repository-reading tools; the review identifies concrete evidence;
structured normalization succeeds; the JSON validates.

Its findings are calibration only and are never published as a `CURRENT` review
on the live governance PR.

### Real GitHub Actions proof

A configuration change plus green unit tests is **not** completion. One real
GitHub Actions execution must prove:

1. the exact PR HEAD is checked out;
2. the correct incremental range is selected;
3. declared project context is loaded;
4. OpenCode with Groq is used;
5. real repository files are inspected;
6. a schema-valid result is produced;
7. a canonical GitHub review is published;
8. `review.commit_id == reviewed_head == PR HEAD`.

## Stop conditions

- **Hard provider stop.** If the authorized provider is unavailable, requires
  paid access, or a basic agentic read fails, stop and report the exact
  blocker. Do not introduce another proxy, model provider, agent framework, or
  paid fallback. Groq quota exhaustion is already a demonstrated hard stop and
  may not be worked around by enabling billing.
- **Credentials stop.** If the authorized provider's credentials are absent,
  stop and name the exact scoped repository secrets required. Do not create a
  paid account or enable paid overages.
- **Authorization stop.** If GitHub permissions or account configuration block
  the live run, stop and report the exact authorization needed.
- **Failure honesty.** On model error, rate limit, invalid structured output, or
  incomplete evidence, emit `REVIEW UNAVAILABLE / FAILED`. Never synthesize
  `CODE REVIEW: PASS` because a request failed.
- **No fabrication.** Never publish a fabricated local result. If the workflow
  does not execute because its definition is unavailable to the selected event,
  investigate the supported triggering semantics and report the finding.
- **Scope stop.** Stop rather than editing RW4 production code, merging the
  feature PR, fixing findings automatically, or starting a governance redesign.
