# Backend instructions for AI agents

These instructions apply to every agent modifying code under `be/` and extend the repository-wide rules in `/AGENTS.md`.

Before changing backend architecture or domain behavior, also read:

- `docs/architecture/activity-discovery-and-tour-generation.md`
- `docs/architecture/engineering-principles.md`

The current implementation is the source of truth for what exists. Architecture/spec documents are the source of truth for intended invariants. Do not infer that a planned component already exists; inspect the code first.

## Provider isolation

Provider-specific semantics must terminate at provider adapters/boundaries.

Provider-name branching is allowed in:

- provider adapters;
- provider factories / dependency injection;
- configuration;
- provider-specific transport/telemetry/diagnostics.

Provider-name branching is forbidden by default in domain/application logic, including:

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

when the downstream layer can instead consume a normalized typed fact or capability. Do not merely move such branching into another downstream helper.

## Typed canonical domain contracts

Do not use `Record<string, unknown>`, arbitrary `metadata` bags, string-keyed payloads, or unchecked casts as hidden APIs for facts that participate in canonical decisions.

If a fact is consumed by quality, classification, identity, geography, coverage, ranking, composition, or planning, represent it with an explicit typed contract at the appropriate boundary.

`metadata` may carry optional provenance/extensibility data, but canonical business behavior must not depend on undocumented provider-specific keys hidden inside it.

## Normalize at boundaries

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

Core services reason about facts, evidence, capabilities, and domain concepts — not vendor identities or raw provider schemas.

## Single source of policy truth

Before adding matching, quality, classification, coverage, geographic, identity, ranking, composition, or planning logic, locate the existing canonical primitive/policy and reuse it.

Do not create a second implementation because it is locally convenient. If the existing primitive is insufficient, change or extend the canonical contract deliberately rather than introducing parallel semantics.

## No magic semantic defaults

Do not invent default scores, classifications, coordinates, identities, provider facts, component order, evidence, or semantic truth merely to satisfy thresholds or tests.

Unknown remains unknown unless grounded evidence supports a value.

Do not weaken production invariants to preserve obsolete fixtures.

## Tests and fixtures

Tests must speak the same semantic contracts and scales as production.

Semantically important fixture values should be explicit. Avoid defaults whose meaning can silently drift (for example, a legacy `0..1` score after production moved to `0..5`).

When a test fails after a canonical invariant becomes live, determine whether the production implementation is wrong or the fixture/expectation is stale before changing either.

Integration tests that claim catalog reuse must prove real reuse through canonical persisted state, not through manual DB patching or reacquisition followed by dedupe.

## Migration and cutover discipline

When replacing a legacy orchestration path, do not create an indefinite dual pipeline.

Intermediate migration checkpoints may temporarily coexist while work is in progress, but final cutover gates must make superseded decision-making unreachable from new requests.

Do not add silent fallback to legacy behavior when the new architecture cannot satisfy a request. Fail or degrade explicitly according to the canonical design.

## Maintainability gate before commit

Before committing a backend milestone, inspect the changed code for:

- provider leakage into core/domain services;
- canonical facts hidden in metadata bags;
- duplicate policy implementations;
- magic semantic constants/defaults;
- stale scale/unit assumptions;
- unnecessary casts or `any` at domain boundaries;
- legacy paths that remain reachable accidentally;
- special-case patches for one destination/provider/request when the issue is general.

A green test suite is necessary but not sufficient if the change violates these boundaries.
