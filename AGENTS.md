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
