# tour-generation integration suite (`yarn test:integration`)

Real internal components (`PrismaService`, `ExperienceCatalogService`,
`ExperienceProposalResolverService`, `CoverageAnalyzer`,
`ExperienceAcquisitionPlannerService`, `ExperienceAcquisitionService`,
synthesizer, corroboration, ranking, `GreedyDailyPlanningSolver`,
`TourPlanningFeasibilityValidatorService`) against a **real Postgres**
(`docker-compose --profile dev up -d postgres`, or the CI `backend-integration`
job). Only external transports are faked (Places / grounded search / discovery
extractor / OSM / Wikivoyage HTTP / `TRAVEL_ESTIMATE_PROVIDER` / embeddings /
image / outbox / destination resolution).

Shared helpers: `../support/test-db.ts` (connect + `TRUNCATE ... RESTART
IDENTITY CASCADE`), `../support/seed.ts` (`seedVerifiedExperience`, `seedTour`).

## Status

- `catalog-retrieval.integration-spec.ts` — **green**. Proves the DB seam:
  real `ExperienceCatalogService.findVerifiedWithin` over seeded rows in real
  Postgres, radius + VERIFIED filtering.

## Pending (Phase 7 Checkpoint F follow-up — full `generateTourExperiences` harness)

The specs below need a `Test.createTestingModule` that wires the real
`ExperienceGenerationService` graph (per the provider list above) with the
external boundaries faked. That harness is scaffolded here as `describe.skip`
so the durable, behavior-named taxonomy exists; each is a straight
implementation task on top of `support/`:

- `canonical-orchestration.integration-spec.ts` — empty catalog + blocking
  deficit → plan → structured + web → synthesis → corroboration → resolver →
  Prisma persist → re-query → ranking → solver → feasibility → materialized
  Tour; trace shows the real acquisition steps.
- `catalog-first.integration-spec.ts` — sufficient catalog + covered
  preferences → `decision.action === 'none'` → **zero** provider-fake calls.
- `catalog-reuse.integration-spec.ts` — run 1 acquires + persists; run 2
  (same destination, compatible prefs) → sufficient catalog → zero calls.
- `acquisition-degradation.integration-spec.ts` — WV / OSM / Places quota each
  failing with the rest sufficient → Tour still completes.
- `places-admission.integration-spec.ts` — ~50 generic cafés/bars/chains +
  a few real tourism food Experiences, request `food + nightlife` → generic
  operational venues do NOT become VERIFIED Experiences (type semantics, not
  fixture strings); a real evidence-backed food Experience can.
- `long-tail-acquisition.integration-spec.ts` — `theme=food` + `trait=craft
  beer` + `trait=specialty coffee`, catalog deficit → CoverageAnalyzer deficit
  → planner → `web` SourcePlan → grounded fake → extractor fake → candidates
  carrying those traits; no new enum.
- `day-trip.integration-spec.ts` — Argentina fixture, base Buenos Aires:
  base destination preserved; a `day_trip` candidate is acquired, resolved
  within boundary, planned same-day, not replaced by an arbitrary POI.
- `no-direct-persistence.integration-spec.ts` — a Places observation never
  yields a VERIFIED `Experience` without going through the resolver.
- `duplicate-delivery.integration-spec.ts` — same proposal + evidence twice /
  a generation retry → no duplicate `Experience` rows.
- `routing-boundary.integration-spec.ts` — solver consumes
  `TRAVEL_ESTIMATE_PROVIDER` (never Geoapify directly); route-shaped Experience
  connects `previous.endFootprint → next.startFootprint`; internal legs use the
  same provider; `approximate: false` propagates to `travelFromPrevious` +
  routing counts; a fallback estimate is reflected in solution metadata.
