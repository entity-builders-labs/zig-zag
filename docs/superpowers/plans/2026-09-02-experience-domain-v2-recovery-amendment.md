# Experience Domain V2 Recovery — Scope Amendment

**Branch:** `feat/experience-domain-v2`  
**Applies to:** `2026-09-02-experience-domain-v2-recovery-completion-plan.md`  
**Status:** binding amendment for the remaining recovery work

## Why this amendment exists

The recovery plan originally included a CP12 admin catalog-population subsystem. That direction has been intentionally reverted. Catalog growth is not a separate product domain and must not be represented by a dedicated `CatalogPopulationJob`, controller, queue processor, persistence model, or admin-only acquisition engine.

The replacement product concept is documented separately in:

`docs/superpowers/plans/2026-09-02-experience-search-and-catalog-expansion.md`

That plan is deferred until the current Experience Domain V2 recovery is closed.

## CP12 status — superseded, not PASS

CP12 is removed from the completion requirements of this recovery plan.

The following CP12-specific implementation has been removed from the branch:

- `CatalogPopulationJob` Prisma model;
- catalog-population migration;
- catalog-population DTO and interface;
- admin guard and controller;
- catalog-population service and processor;
- dedicated catalog-population persistence/state machine.

`ExperienceAcquisitionService` remains intentionally. It is not a CP12 subsystem: it is a reusable V2 acquisition boundary used by the normal Experience pipeline and is also the correct future primitive for Experience Search / catalog expansion.

Do not reintroduce CP12 while closing this plan.

## CP13 status — corrected design

CP13 means **day-trip facet support**, not a day-trip domain model.

`day_trip` is a soft Experience intent/facet exactly like `visit`, `walk`, `food`, `nightlife`, or route-like intent. It introduces no new:

- entity or persistence model;
- Tour request model;
- generation service;
- queue/event/topic;
- processor/state machine;
- planner;
- trace model;
- origin-bound/open-destination abstraction.

For a base destination such as Buenos Aires, the facet changes only focused discovery semantics when coverage is insufficient. A discovery query may become `day trips from Buenos Aires` / `escapadas desde Buenos Aires` plus the user's other requested themes/preferences. Any discovered candidate then traverses the unchanged V2 pipeline:

`grounded evidence → extraction → GeoEntity resolution → geographic validation → conservative dedupe → Experience persistence → embedding → catalog requery → deterministic ranking → deterministic planner → TourExperience snapshots`.

If the local catalog already has sufficient matching `day_trip` Experiences, no grounded discovery is required.

## Remaining completion order

The recovery plan now closes in this order:

1. **CP3** — finish geographic provider-state regression evidence, including distinct provider failure/rate-limit/empty-result semantics where the active adapter contract supports them.
2. **CP8** — finish scale/quality E2E evidence over persisted Experience catalogs, including preference sensitivity, deterministic repeatability, and duplicate-delivery/idempotency evidence.
3. **CP10** — prove retryable generation failure recovery end-to-end (`429/transient → retry → success`) without duplicate completion/failure artifacts.
4. **CP11** — finish Bitácora V3 persistence/rendering audit: exact prompts/raw responses/queries/evidence/decisions, centralized secret redaction, persisted execution summary, routing/materialization evidence.
5. **CP13** — implement and prove `day_trip` as a soft facet only.
6. **CP14** — cleanup/cutover audit and final one-HEAD verification.

CP12 is not a blocker because it is superseded and explicitly moved to the separate future plan.

## CP14 destructive-cutover gate

Do not perform additional destructive domain cleanup merely to make the plan look complete. Before deleting any remaining historical Activity runtime/schema surface, prove at the same candidate HEAD:

- Experience generation smoke test passes;
- duplicate delivery is idempotent;
- catalog reuse path passes;
- frontend V2 path passes;
- no active runtime consumer depends on Activity;
- empty-database Prisma migration chain succeeds.

Only then may historical leftovers be removed. If the destructive cutover is already represented by an existing migration, audit it rather than creating a second competing migration.

## Definition of closed recovery plan

The plan is closed only when a single final HEAD has evidence for:

- backend typecheck;
- backend lint;
- backend unit/integration tests required by the checkpoints;
- V2 scale/quality acceptance tests;
- backend E2E;
- frontend type/lint/tests relevant to V2;
- deterministic Playwright V2 path;
- empty-database Prisma migration chain;
- build/server boot or the repository's equivalent CI gate;
- no CP12-specific implementation remaining;
- no special day-trip architecture;
- updated architecture/recovery docs and PR description/checkpoint matrix.

A checkpoint is never marked PASS from code inspection alone. Normal path, degraded/regression path, and observable test/CI evidence are required.