# Experience Domain V2 — Implementation Inventory

Date: 2026-09-01  
Branch: `feat/experience-domain-v2`  
Base: `83ceb3b293d1801f123c4f10c292ab8d15785205`

## Preflight

- HEAD: `3c1b52189dfcff071dc40eff70145e7c58896060` (plan-only commit on the base).
- CodeGraph: available (`.codegraph/` present; used for the initial symbol/call-path inventory).
- DB safety: local development database. `.env` has `NODE_ENV=development` and a localhost PostgreSQL URL; `zigzag-postgres` is a healthy Docker container using database `zigzag`. No reset/drop/rebaseline was performed.

## Current implementation map

| Responsibility | Current implementation |
| --- | --- |
| TourGenerationRequested async flow | `be/src/modules/tours/services/tour-generation-wizard.service.ts`, `tour-generation.service.ts`, `tour-generation-processor.service.ts` |
| Outbox publisher/consumer | `be/src/modules/outbox/`, `be/src/modules/tours/services/tour-generation-processor.service.ts` |
| Media enrichment + negative cache | `be/src/modules/tours/services/tour-image.service.ts`, image provider/cache services and Prisma media fields |
| GenerationTrace persistence/UI | `be/src/modules/tours/interfaces/generation-trace.interface.ts`, `generation-trace-builder.util.ts`, `tour-activity-generation.service.ts`, `fe/components/tour-details/GenerationBitacora.tsx` |
| Grounded discovery/extraction | `be/src/modules/tours/services/activity-discovery.service.ts`, `gemini-discovery.provider.ts`, `groq-discovery.provider.ts`, grounded-search adapters |
| Entity resolution | `activity-proposal-resolution.service.ts`, `activity-proposal-pipeline.service.ts`, Google Places and OSM integrations |
| Geographic validation | `composite-geographic-validation.service.ts`, `geographic-validation.interface.ts` |
| Materialization | `activity-proposal-materialization.service.ts`, `activity-proposal-pipeline.service.ts` |
| Coverage | `coverage-analyzer.service.ts`, `tour-format-coverage-validator.service.ts`, coverage interfaces |
| Ranking/window | `candidate-ranking.util.ts`, `candidate-window-selection.util.ts`, `planning-candidate-normalizer.service.ts` |
| Planning normalizer/solver | `planning-candidate-normalizer.service.ts`, `greedy-daily-planning.solver.ts`, daily-planning utilities |
| TourExperience persistence/snapshots | Prisma `Experience`/`TourExperience` models exist; the worker still persists `TourActivity` as its schedulable output |

## Material divergence from V2

- The schedulable unit is still `Activity`; `ActivityKind` and structural formats remain planner/coverage inputs.
- Composite discovery still emits `ActivityProposal` with `ProposalKind`, including `NEIGHBORHOOD_WALK`.
- Resolved entities and geographic validation are present, but materialization still targets Activities rather than `GeoEntity` + `Experience`.
- The current final acquisition gate can hard-fail when a requested structural format has no accepted candidate, even when other real candidates exist.
- A deterministic daily solver already exists, but its contracts are `PlanningActivityCandidate`/`PlannedActivity` and it is downstream of legacy format gates.
- A legacy LLM itinerary path remains in `tour-generation.service.ts`; it is distinct from the wizard's deterministic daily solver.
- Trace support is V2/legacy-shaped and does not yet satisfy the complete V3 per-call prompt/raw-response/redaction contract.
- Async Outbox, retry/idempotency, and non-fatal media enrichment are existing infrastructure to preserve during migration.

## Initial migration constraint

Increment A must document the V2 contracts and Bitácora V3/redaction boundary without changing the async/outbox/media architecture. Domain/schema changes begin only after this inventory is committed.

## Progress after initial inventory

- Added `GeoEntity`, `Experience`, component/evidence/trait relations and `TourExperience` schema. The temporary Activity→Experience bridge was removed; native materialization is still pending.
- Added centralized recursive Bitácora redaction and a traced `preference_interpretation` stage. Free-text preferences are normalized through the configured chat provider and hard exclusions are enforced deterministically before ranking.
- Removed structural format feasibility gates from coverage/planning. Missing `ExperienceFormat` values no longer fail a tour or trigger kind-specific discovery; theme gaps use generic grounded discovery.
- Added a synthetic point/radius `DestinationScope`, so point-scale destinations continue through resolution and geographic validation.
- Terminal failed generation events are now acknowledged as duplicate no-ops by the worker; explicit retries remain API-driven.
- Added a provider-neutral query planner and native Gemini `ExperienceCandidate` extraction/validation boundaries. They are not wired into the worker yet.
- Real runs: `78101c2b-caf0-435b-b01d-8fe106103790` failed deterministically on walking feasibility; `0c510f27-7289-4d34-a6c6-f58a7b7ab2f3` and `c481f46b-0d7b-4505-b322-43be2e79e33a` completed through the legacy Activity pipeline with zero `TourExperience` snapshots.

Remaining material divergence: the planner and persistence path still expose legacy `Activity`/`ActivityKind` contracts internally, and discovery providers still return the compatibility `ActivityProposal` shape even when the search itself is generic.
