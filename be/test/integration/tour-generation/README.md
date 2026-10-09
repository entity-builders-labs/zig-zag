# tour-generation integration suite (`yarn test:integration`)

The durable, behavior-named integration category for the productive
tour-generation graph. It runs the **real internal orchestration** against a
**real Postgres**, faking only the external transports.

- **Real** (no mocks): `ExperienceGenerationService.generateTourExperiences`,
  `CoverageAnalyzer`, `ExperienceAcquisitionPlannerService`,
  `ExperienceAcquisitionService` (structured + `web` SourcePlan),
  `StructuredExperienceCandidateSynthesizerService`,
  `StructuredCandidateCorroborationService`,
  `ExperienceProposalResolverService` +
  `CompositeGeographicValidationService`, `ExperienceCatalogService`,
  `PrismaService` (schema constraints, relations, transactions, advisory-lock
  dedupe), preference/semantic ranking, `PlanningCandidateNormalizerService`,
  `GreedyDailyPlanningSolver`, `TourPlanningFeasibilityValidatorService`,
  `TourExperience` / `TourExperienceComponent` materialization,
  `generationTrace` / `executionSummary`.
- **Faked** deterministic transports only: Google Places, OSM/Overpass,
  Nominatim, Wikivoyage HTTP, grounded web search, the discovery-extractor
  LLM, embeddings, LLM chat, destination resolution, and the
  `TRAVEL_ESTIMATE_PROVIDER`. Each fake speaks a real provider result shape
  and exposes `jest.fn` spies for call-count assertions.

Run locally with `docker-compose --profile dev up -d postgres` (or any
reachable `DATABASE_URL`); CI runs it in the `backend-integration` job
(`pgvector/pgvector:pg16` + `prisma:deploy`). `test:acceptance` stays DB-free.

## Support

- `../support/test-db.ts` — env load, real `PrismaService` connect,
  `TRUNCATE ... RESTART IDENTITY CASCADE` between scenarios.
- `../support/seed.ts` — `seedVerifiedExperience`, `seedTour`, `ALWAYS_OPEN`.
- `support/harness.ts` — one reusable `TourGenerationHarness` that boots the
  real `AppModule`, overrides the external boundaries, and exposes
  `configure(scenario)`, `generate(tourId)`, `loadTour(tourId)` and the fake
  spies. Do not build a second Nest module per spec.
- `support/fakes.ts` — the deterministic fake transports + builders
  (`osmPoi`, `placeData`, `venueHint`).

## What the suite covers

| spec | behavior |
| --- | --- |
| `canonical-orchestration` | empty catalog + blocking deficit → plan → structured source **and** web SourcePlan → synthesis → corroboration → resolver → real Prisma persistence → catalog re-query → ranking → solver → feasibility → materialized Tour; trace carries the real acquisition step (no legacy "Places crawl"); `executionSummary.acquisition` reflects the run. |
| `catalog-first` | a sufficient VERIFIED catalog → `CoverageAnalyzer` decides `none` → **zero** calls to every faked transport; the Tour is still planned from the catalog. |
| `catalog-reuse` | run 1 acquires + persists; run 2 (same DB, compatible request) → catalog now sufficient → zero provider calls, no duplicate Experience rows, Tour built from the reused catalog. |
| `acquisition-degradation` | Wikivoyage / OSM / Google Places each failing while the rest stay sufficient → Tour still completes; the trace/`executionSummary` name the attempted + failed provider, provider-neutrally. Every-source-fails + empty catalog → generation fails with `retryable: true`. Places holds no special failure authority. |
| `places-admission` | a food + nightlife request routes contextual commercial types to Places; bare `restaurant`/`cafe`/`bakery`/`bar`/`night_club` venues are admitted as observations but never become VERIFIED Experiences (source-type semantics, not a name blacklist, not a ratings threshold); evidence-backed tourism food still can. |
| `long-tail-acquisition` | `theme=food` + open traits `craft_beer` / `specialty_coffee` the catalog lacks → deficit → planner → web SourcePlan (traits forwarded as open traits, excluded preferences not) → grounded fake → extractor fake → `ExperienceCandidate` with open traits → resolver → persistence → available to the planner. No new enum. |
| `day-trip` | `day_trip` intent from a Buenos Aires base → a day-trip Experience is acquired, resolved within scope, the base destination is unchanged, and the planner places it in a valid day rather than swapping an arbitrary POI. |
| `no-direct-persistence` | a provider observation is never a VERIFIED Experience: nothing is persisted until the resolver runs; the resolver is the only path to a row; an ungroundable observation lands nothing. |
| `duplicate-delivery` | the same proposal + evidence delivered on a second run reconciles to one logical Experience (resolver SAME/dedupe + GeoEntity identity), no duplicate rows/components. |
| `routing-boundary` | the deterministic planner routes only through `TRAVEL_ESTIMATE_PROVIDER` (a fixture, never a network call); a real-routing result (`approximate:false`) and an approximate fallback (`fallbackReason` set) both propagate to `travelFromPrevious`, the routing provider counts and the approximate count; a route-shaped Experience is routed by its component endpoints, not its centroid. |
| `catalog-retrieval` | focused DB-seam test: `ExperienceCatalogService.findVerifiedWithinForMatching` (the one PostGIS catalog boundary) over seeded rows in real Postgres (radius + VERIFIED filtering). Not a substitute for canonical orchestration. |
| `generation-catalog-snapshot` | PF-REV-SNAPSHOT-WINDOW-1: `readCatalogSnapshot` reads the PostGIS boundary coverage reads -- an in-radius row behind 1000 unrelated id-earlier rows, a 251st-by-distance row, and a late PLANNER_CAPACITY row with >1000 unrelated global rows all reach the snapshot; destination eligibility and the explicit-id merge are unchanged. |
| `partial-composite-isolation` | Stage 4 hard gates: a source-backed A-B-C-D-E-F with C/E unresolved (or B ambiguous) persists only the resolved GeoEntities -- no VERIFIED trimmed Experience, nothing visible to `findVerifiedWithinForMatching`, no standalone Experience per component; a complete composite persists exactly its source membership/order; later composites reuse the GeoEntities catalog-first. |
