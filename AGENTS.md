# Repository instructions for AI agents

The current codebase is the source of truth. Read the relevant module README
and inspect the implementation before proposing or applying changes.

These instructions apply to every AI coding/design agent working in the repo,
including Codex, Claude, Antigravity, and future agents. Tool-specific files
must not become independent sources of architectural truth.

## Canonical engineering instructions

`/AGENTS.md` is the single repository-wide cross-agent contract.

Do not create additional scoped `AGENTS.md` files unless the repository grows
to a point where a genuinely independent subtree requires its own instruction
contract. Durable repository engineering rules belong here; detailed rationale,
diagrams, and examples belong in `docs/architecture/engineering-principles.md`.

When an architectural rule can be checked mechanically, prefer enforcing it
with lint/architecture tests/CI in addition to documenting it. A green test
suite does not justify violating documented architectural boundaries.

For backend architecture and maintainability work, also read:

- `docs/architecture/engineering-principles.md`

For Places-provider acquisition/classification work on
`feat/preference-first-selection`, also read
`docs/superpowers/specs/2026-09-12-places-provider-cost-control-amendment.md`.
It supersedes the older B1 instruction to request Google
`editorialSummary` on every baseline search: the core is provider-agnostic
(`IPlacesApiService`, currently Google or Geoapify), and paid provider-specific
narrative fields must remain optional/selective rather than baseline-required.

Before changing any of the following areas, read
`docs/architecture/activity-discovery-and-tour-generation.md` completely:

- tour or activity generation;
- destination resolution;
- candidate retrieval, coverage, ranking, or embeddings;
- transportation modes, spatial feasibility, routing, travel times, or
  itinerary scheduling;
- Google Places, OSM, Nominatim, Overpass, or discovery providers;
- composite Activities, families, waypoints, or tour snapshots;
- Prisma models related to Activities or Tours.

That document describes target architecture and invariants. It does not imply
that every component shown there is already implemented. Confirm implementation
status in the repository and preserve the boundaries between Destination
Resolution, Activity Discovery, Entity Resolution, Validation, and Tour
Generation.

## Mandatory engineering-principles gate

This gate applies automatically to **every non-trivial implementation, refactor,
review, migration, and milestone**. The user does not need to restate it in each
task. Treat it as part of the definition of done, not as optional guidance.

### Before implementation

1. Read the applicable sections of
   `docs/architecture/engineering-principles.md` and every architecture/spec/plan
   document made mandatory by this file for the code being changed.
2. Identify the engineering principles and architectural invariants that
   constrain the task.
3. Inspect the affected call graph, ownership boundaries, canonical policy
   owners, and data contracts before choosing an implementation.
4. Identify existing violations in code that the task will touch. Do not
   silently preserve or deepen a known violation when a canonical replacement
   is available.
5. If the requested implementation conflicts with a canonical principle or
   invariant, **STOP before coding and surface the conflict**. Do not choose a
   locally convenient bypass or compatibility path.

The preflight is required even when the requested change appears small if it
changes domain behavior, provider integration, canonical data, orchestration,
identity, ranking, composition, planning, persisted contracts, or shared
frontend behavior.

### During implementation

- Do not introduce a new engineering-principles violation to complete the local
  task.
- When modifying a boundary that already violates a principle, fix the touched
  violation when the canonical replacement is known and the fix is within the
  task's natural scope. Do not use this rule as permission for unrelated broad
  refactors.
- Reuse the canonical policy/contract instead of adding parallel semantics.
- Keep unknown states explicit; do not invent semantic defaults to make tests
  or thresholds pass.
- Green tests never override an architectural invariant.

### Early-stage deletion rule

Zig-Zag is still early-stage. Unless an explicit current product requirement
says otherwise, persisted historical development data and superseded internal
contracts are disposable.

When a new architecture replaces an old one:

- delete superseded legacy decision paths, adapters, DTOs, compatibility
  projections, dead callers, and tests whose only purpose is preserving the
  discarded contract;
- do not retain historical read compatibility, dual authorities, or fallback
  paths "just in case";
- do not move obsolete code into a `legacy`/`compat` module merely to keep it;
- preserve compatibility only when the user/product explicitly requires it.

Migration checkpoints may coexist only while the replacement is genuinely
under construction. A completed cutover has one authority.

### Completion gate

Before declaring a non-trivial task or milestone complete:

1. Re-review the changed code against every applicable engineering principle.
2. Report a concise **PASS/FAIL** result for the applicable categories (for
   example provider isolation, typed boundaries, single policy authority,
   unknown/no-magic-default semantics, dependency direction, migration
   cutover, frontend domain ownership).
3. Inspect for violations that tests/typecheck/lint do not detect, including
   hidden metadata protocols, provider-name branching, unchecked boundary
   casts, duplicate policy implementations, and obsolete paths left reachable.
4. Run the verification required by the task/milestone.

A task or milestone **MUST NOT be marked complete while any applicable
engineering-principles check is FAIL**. Tests, typecheck, and lint being green
are necessary evidence, but they are not sufficient for completion.

## Backend architecture and code-quality invariants

These rules apply to all new and modified backend code.

### Provider isolation

Provider-specific semantics must terminate at provider adapters/boundaries.

Provider-name branching is allowed in:

- provider adapters;
- provider factories / dependency injection;
- configuration;
- provider-specific transport/telemetry/diagnostics.

Provider-name branching is forbidden by default in domain/application logic,
including:

- candidate synthesis;
- quality scoring;
- classification;
- coverage/sufficiency;
- catalog logic;
- ranking;
- identity/dedupe;
- composition;
- planning.

Do not add downstream code such as:

```ts
if (provider === 'google_places') { ... }
if (provider === 'wikivoyage') { ... }
```

when the downstream layer can instead consume a normalized typed fact or
capability. Do not merely move such branching into another downstream helper.

### Typed canonical domain contracts

Do not use `Record<string, unknown>`, arbitrary `metadata` bags, string-keyed
payloads, or unchecked casts as hidden APIs for facts that participate in
canonical decisions.

If a fact is consumed by quality, classification, identity, geography,
coverage, ranking, composition, or planning, represent it with an explicit
typed contract at the appropriate boundary.

`metadata` may carry optional provenance/extensibility data, but canonical
business behavior must not depend on undocumented provider-specific keys hidden
inside it.

### Normalize at boundaries

Raw provider payloads are translated once, at the adapter boundary:

```text
provider raw response
        ↓
provider adapter
        ↓
normalized typed facts / evidence
        ↓
domain/application core
```

Core services reason about facts, evidence, capabilities, and domain concepts —
not vendor identities or raw provider schemas.

### Single source of policy truth

Before adding matching, quality, classification, coverage, geographic,
identity, ranking, composition, or planning logic, locate the existing
canonical primitive/policy and reuse it.

Do not create a second implementation because it is locally convenient. If the
existing primitive is insufficient, change or extend the canonical contract
deliberately rather than introducing parallel semantics.

### No magic semantic defaults

Do not invent default scores, classifications, coordinates, identities,
provider facts, component order, evidence, or semantic truth merely to satisfy
thresholds or tests.

Unknown remains unknown unless grounded evidence supports a value.

Do not weaken production invariants to preserve obsolete fixtures.

### Tests and fixtures

Tests must speak the same semantic contracts and scales as production.
Semantically important fixture values should be explicit. Avoid defaults whose
meaning can silently drift, such as a legacy `0..1` score after production
moves to `0..5`.

When a test fails after a canonical invariant becomes live, determine whether
the production implementation is wrong or the fixture/expectation is stale
before changing either.

Integration tests that claim catalog reuse must prove real reuse through
canonical persisted state, not through manual DB patching or reacquisition
followed by dedupe.

### Migration and cutover discipline

When replacing a legacy orchestration path, do not create an indefinite dual
pipeline.

Intermediate migration checkpoints may temporarily coexist while work is in
progress, but final cutover gates must make superseded decision-making
unreachable from new requests.

Do not add silent fallback to legacy behavior when the new architecture cannot
satisfy a request. Fail or degrade explicitly according to the canonical
design.

### Maintainability gate before commit

Before committing a backend milestone, inspect the changed code for:

- provider leakage into core/domain services;
- canonical facts hidden in metadata bags;
- duplicate policy implementations;
- magic semantic constants/defaults;
- stale scale/unit assumptions;
- unnecessary casts or `any` at domain boundaries;
- legacy paths that remain reachable accidentally;
- special-case patches for one destination/provider/request when the issue is
  general.

A green test suite is necessary but not sufficient if the change violates these
boundaries.

### Commit message discipline

These rules apply to every coding agent and tool that creates commits in this
repository, including Codex, Claude, Antigravity, OpenCode, and future agents.

For every non-trivial fix, refactor, migration, architectural milestone, or
behavioral change, use this exact shape:

```text
<subject>

- <bullet>
- <bullet>
- <bullet>
```

Formatting requirements:

- Use Conventional Commit style for the subject when applicable.
- Keep the subject at 72 characters or fewer.
- Put exactly one blank line between the subject and body.
- Write the body as compact `- ` bullets, not prose paragraphs.
- Do not put blank lines between body bullets.
- Wrap body lines at approximately 72 characters; indent continuation lines.
- Subject-only commits are allowed only for genuinely trivial changes where
  the subject fully explains the change.

For non-trivial commits, the body must preserve durable context when applicable:

- WHY: the problem, invariant, or failure that motivated the change.
- WHAT: the important implementation or architectural effects.
- BEHAVIOR: behavior intentionally changed or preserved.
- DEBT: explicit follow-up debt intentionally left behind.
- VALIDATION: tests, typecheck, lint, live checks, or other verification that
  was actually executed.

Never invent validation results. Mention only commands/checks that were really
run and their real outcome. Do not rely on chat/session history as the only
record of architectural rationale.

Canonical example:

```text
refactor(tours): verify identity before persistence

- Keep acquired candidates transient until identity verification.
- Persist GeoEntities only after VERIFIED identity decisions.
- Move Wikidata evidence acquisition outside the pure verifier policy.
- Preserve P0.1, P0.2, P1, and P2-B fail-closed behavior.
- Validate with the executed test suite, typecheck, lint, and diff check.
```

Before creating a non-trivial commit, review the complete message against this
section. A technically correct change with a non-conforming commit message is
not complete.

## Frontend responsive layout convention

Zig-Zag targets web, iOS, and Android from the same frontend. Preserve a
consistent application canvas when navigating between screens.

- Top-level application screens fill the available viewport: screen roots use
  full width and `flex: 1` (or the equivalent for that surface).
- Do not constrain an entire screen with `maxWidth`, a fixed desktop width, or
  a centered phone-sized shell. Navigation between screens must not make the
  whole application jump between full-width and a narrow centered column.
- Responsive width constraints belong inside the screen, around content that
  benefits from a readable maximum width (for example forms, long text,
  settings panels, or dense detail sections), not around the screen root.
- Map and other immersive surfaces normally use the full available width.
- A full-width screen does not mean every child should stretch indefinitely on
  desktop. Constrain individual content sections responsively where that
  improves readability while keeping the screen/app shell itself full-width.
- When changing a shared screen, consider web, iOS, and Android behavior. Do
  not fix one platform by reintroducing a root-level width constraint that
  makes another platform or web navigation visually inconsistent.

In short:

```text
screen / app shell = full viewport
content sections    = may use responsive max-width where appropriate
```

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Context discipline

Keep development tasks focused on the requested outcome and current phase.
Reuse files, symbols, and findings already inspected; do not reread or
reprint unchanged material. Prefer focused CodeGraph queries, `rg`, and
bounded file ranges. Keep command output concise: summarize logs and inspect
only relevant failure excerpts instead of dumping complete files, documents,
HTML responses, or stack traces. Full reads required by this file remain
mandatory, but their contents need not be repeated in chat. Avoid unrelated
inventories, speculative refactors, and unnecessary IDE/MCP/integration
context. For long tasks, keep a concise handoff/progress note and split work
into clear milestones so the chat can be compacted or restarted between them.
