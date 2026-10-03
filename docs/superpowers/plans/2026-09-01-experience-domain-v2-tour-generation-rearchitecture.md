# Zig-Zag — Experience Domain V2 & Tour Generation Re-architecture

**Date:** 2026-09-01  
**Repository:** `jiseruk/zig-zag`  
**Base branch:** `feat/geographic-validation-outbox-media-hardening`  
**Verified base SHA:** `83ceb3b293d1801f123c4f10c292ab8d15785205`

## Goal

Replace the current `Activity + ActivityKind` paradigm with an Experience-centric domain while preserving the operational architecture already built.

> Everything the planner can place in a Tour is a persisted `Experience`.

Physical reality is modeled separately as `GeoEntity` with `PLACE | AREA | ROUTE`.

Target flow:

```text
User Intent
  ↓
Preference Interpretation when free text exists
  ↓
Geographic Intent Scope
  ↓
Local VERIFIED Experience Catalog Search
  ↓
Experience Coverage
  ├─ sufficient ──────────────────────────────┐
  └─ insufficient                             │
       ↓                                      │
Grounded Experience Discovery                 │
       ↓                                      │
ExperienceCandidate[]                         │
       ↓                                      │
Evidence Validation                           │
       ↓                                      │
GeoEntity Resolution                          │
       ↓                                      │
Geographic Validation                         │
       ↓                                      │
Experience Deduplication                      │
  ├─ SAME → enrich existing                   │
  ├─ NEW → persist                            │
  └─ AMBIGUOUS → conservative handling        │
       ↓                                      │
Requery Experience Catalog ───────────────────┘
       ↓
Match / Rank / Candidate Window
       ↓
Deterministic Daily Planner
       ↓
Selected Experiences
       ↓
Internal Experience Routing
       ↓
External Tour Routing
       ↓
TourExperience snapshots
       ↓
Tour COMPLETED
```

## Non-negotiable invariants

1. `Experience` is the only schedulable tourism unit.
2. `GeoEntity` describes physical reality only: `PLACE`, `AREA`, `ROUTE`.
3. `POI` disappears as a structural Activity kind. A visitable POI becomes `GeoEntity PLACE` plus a persisted visit Experience.
4. The planner NEVER invents Experiences by combining nearby places.
5. Experiences exist before planning and are either grounded+validated or curated+validated.
6. Experience verification is `grounded evidence + GeoEntity resolution + geographic coherence`.
7. Routing is NOT proof of Experience existence.
8. Routing has two layers: internal Experience routing and external Tour routing.
9. The planner is algorithmic/deterministic. DO NOT use an LLM as the itinerary planner or selector.
10. LLMs may interpret free-text preferences and extract grounded ExperienceCandidates, but deterministic code applies constraints, filtering, validation and planning.
11. Missing preferred theme/trait may lower satisfaction or trigger discovery; it must not automatically fail a Tour.
12. Hard constraints may fail planning only when truly infeasible.
13. Tour generation remains asynchronous and durable through transactional Outbox + queue + idempotent/retryable workers.
14. Media enrichment remains asynchronous/eventual/non-fatal.
15. Media persistence stores image URLs/metadata only; do not download/store image binaries as part of this domain flow.
16. Bitácora is a first-class debugger for every non-deterministic boundary.
17. Never persist API keys, Authorization headers, tokens, cookies or credentials in Bitácora.
18. The Experience Catalog is persistent product data, not a disposable cache.
19. Tour generation is NOT the only trigger for Experience acquisition. Admin/manual/catalog-population jobs use the same acquisition pipeline.
20. The operational goal is to minimize grounded search during Tour generation as a destination catalog matures.

## Mandatory preflight

Before changing code:

1. Read `AGENTS.md`.
2. Read `docs/architecture/activity-discovery-and-tour-generation.md` completely.
3. Verify actual HEAD and compare against base SHA above. If the branch advanced, inspect the diff and adapt; never discard newer commits.
4. If `.codegraph/` exists, use CodeGraph before grep/find as required by `AGENTS.md`.
5. Inspect `Makefile`, `be/package.json`, `fe/package.json`, Prisma schema/migrations and current Tour generation call paths.
6. Confirm DB reset safety before ANY destructive Prisma/SQL action.

### Destructive stop condition

The plan assumes local/dev/test data may be discarded and Prisma can be rebaselined. Before any reset/drop/recreate, prove the target is not production, shared RDS, or user data. If real data must survive: STOP and first design an `Activity → GeoEntity/Experience/TourExperience` migration matrix.

## Implementation inventory required before Increment A

Produce a short inventory with:

```text
- exact HEAD SHA
- CodeGraph availability
- DB reset safety determination
- files/symbols implementing:
  * TourGenerationRequested async flow
  * Outbox publisher/consumer
  * media enrichment + negative cache
  * GenerationTrace persistence/UI
  * grounded discovery/extraction
  * entity resolution
  * geographic validation
  * materialization
  * coverage
  * ranking/window
  * planning normalizer/solver
  * TourActivity persistence/snapshots
- any material divergence from this plan
```

If no invariant is contradicted, continue. If a material contradiction is found, document it before silently redesigning.

# Target domain model

Use the repository style and Prisma conventions, but preserve these responsibilities.

## GeoEntity

```text
GeoEntity
- id
- name
- kind: PLACE | AREA | ROUTE
- latitude?
- longitude?
- geometry?
- address?
- metadata?
- identities[]
```

`GeoEntityIdentity`:

```text
- geoEntityId
- provider
- externalId
UNIQUE(provider, externalId)
```

Provider identity is not Experience identity. Cross-provider merging must be conservative.

## Experience

```text
Experience
- id
- canonicalName
- description?
- durationMinutes?
- price?
- status: PENDING | VERIFIED | REJECTED | ARCHIVED
- qualityScore?
- representative latitude/longitude?
- components[]
- evidence[]
- traits[]
- image URLs / media status
- embedding + embedding metadata
- metadata?
```

Representative lat/lng is logistical/search metadata, not identity.

## ExperienceComponent

```text
- experienceId
- geoEntityId
- order?
- role?
- required
```

`order` may be null when sequence is not intrinsic.

## ExperienceEvidence

```text
- experienceId
- source
- url?
- title?
- snippet?
- discoveredAt
```

Evidence must be additive and deduplicated only with a genuinely stable key.

## Traits

Use dynamic lookup data (`TraitDefinition` + `ExperienceTrait`), not a giant Prisma enum.

Initial dimensions can include:

```text
THEME: history, architecture, food, tango, art, nature, culture
MOBILITY: walking, cycling, driving, public_transport, boat
ACTIVITY_STYLE: guided, self_guided, participatory, spectator
ENVIRONMENT: indoor, outdoor, water
SPATIAL_PATTERN: single_place, multi_stop, linear, circuit, regional
DISCOVERY_STYLE: iconic, local, hidden_gem
```

This is extensible, not a closed taxonomy.

## TourExperience + snapshots

Replace TourActivity-oriented persistence with `TourExperience` and a component snapshot (`TourExperienceComponent`) so historical Tours do not mutate when the shared Experience changes later.

# Bitácora V3 — implement early

Bitácora must become a debugger of the pipeline, not just a friendly summary.

Every LLM invocation must expose, secret-redacted:

```text
purpose
provider
model
attempt
exact system prompt
exact user prompt
exact response schema
safe parameters
exact raw response
parsed response
validation result/errors
token usage if available
timing
status/error
```

Every grounded search invocation must expose:

```text
provider
exact query
safe request/config
evidence returned
source/title/url/snippet used
timing
status/failure
```

Also trace enough detail for Places, OSM/Nominatim/Overpass, embeddings, dedupe and routing.

Create a centralized and tested `redactTracePayload` before persisting traces. It must redact auth/api-key/token/cookie/password/secret/bearer fields and patterns.

Suggested V3 stages:

```text
preference_interpretation
tour_intent
destination_resolution
experience_catalog_search
experience_coverage
grounded_discovery
experience_extraction
entity_resolution
experience_validation
experience_deduplication
experience_materialization
candidate_pool
daily_planning
internal_routing
external_routing
embeddings
media_enrichment
verification
```

Preserve readable historical traces if V1/V2 traces already exist.

# User free-text preferences

Integrate the planned LLM interpretation step.

Example:

```text
"No quiero lugares religiosos. Quiero comida vegana y arquitectura. Prefiero caminar."
```

LLM output must become normalized intent, e.g.:

```text
preferredThemes
preferredTraits
excludedThemes
excludedTraits
hardExclusions
notes
positive semanticQuery
```

Rules:

- LLM interprets; deterministic code enforces.
- Negative preferences must not become positive embeddings.
- Exclusions apply to local catalog search, ranking, grounded discovery planning, candidate acceptance and final Tour verification.
- If a required component violates a hard exclusion, the Experience is ineligible.
- The planner must not remove a required component and thereby invent a new Experience.
- Trace exact PreferenceInterpreter prompt/raw/parsed/validation in Bitácora.

# Geographic intent, escapadas/day trips

Do NOT introduce a structural `DAY_TRIP_EXPERIENCE` kind and do NOT require a separate DestinationDiscovery stage.

Keep Experience discovery uniform; only geographic scope changes.

Conceptually support:

```text
destination_bound:
  destination = Tigre
  origin? = Buenos Aires

origin_bound_open:
  origin = Buenos Aires
  destination = open
  maxOutboundTravelMinutes?
  allowedModes?
  sameDayReturn?
  overnightCount?
```

For an open day trip request such as “escapadas desde Buenos Aires”, grounded search may directly discover Experiences like Puerto de Frutos or Delta experiences; GeoEntity resolution then reveals that those Experiences belong to Tigre. The destination may emerge from resolved geography.

Outbound/return travel belongs to the Tour unless an evidence-backed Experience explicitly includes transfer.

Same-day feasibility must account for:

```text
outbound travel
+ selected Experiences
+ internal Experience routing
+ external local routing
+ return travel
<= available day window
```

# Experience Catalog acquisition is first-class

Tour generation is only one trigger.

Support reusable acquisition triggers conceptually:

```text
TOUR_COVERAGE
ADMIN_POPULATION
MANUAL
SCHEDULED_REFRESH (future)
```

`ExperienceAcquisitionService/Pipeline` must be independent of `TourGenerationService`.

Admin example:

```text
Populate Mendoza broadly
```

The discovery planner generates bounded fan-out queries rather than one mega-query, for example winery, gastronomy, walking, culture/history, nature, etc. Every result goes through the SAME trust pipeline:

```text
grounded evidence
→ Experience extraction
→ GeoEntity resolution
→ geographic validation
→ dedupe
→ persist/enrich
→ async media URLs / embeddings
```

Admin population is asynchronous/durable; do not keep HTTP open for a city sweep.

A persistent `ExperienceAcquisitionJob` is optional if Outbox + Bitácora already provide enough lifecycle visibility. If a table is introduced, capture trigger, scope/destination, status, query plan, discovered/verified/deduped/rejected counts and timestamps.

### Operational goal

As a city matures:

```text
Tour request → local Postgres/pgvector → rank → deterministic planner
```

Grounded search during Tour generation should happen only for true local coverage gaps, especially custom/long-tail intent.

Track metrics such as:

```text
local_catalog_hit_rate
grounded_queries_per_tour
experience_catalog_reuse_rate
tour_generations_requiring_grounded_search
```

Bitácora must state WHY grounded search was triggered.

# Discovery V2

Remove discovery by missing `ActivityKind` / `targetKind` / `ProposalKind` / NEIGHBORHOOD_WALK structural rules.

Introduce provider-neutral `ExperienceDiscoveryPlanner` consuming destination/geographic scope, normalized preferences, coverage gaps and breadth (`focused|broad`) and emitting a bounded query fan-out + conditional enrichment policy.

Provider-specific Tavily/Gemini/Groq settings belong only in adapters/configuration.

Conditional enrichment: if first-pass evidence proves the Experience concept and essential structure, continue; otherwise issue a focused enrichment query. Do not enrich every candidate automatically.

# ExperienceCandidate extractor

Target contract conceptually:

```ts
interface ExperienceCandidate {
  name: string;
  description?: string;
  themes: string[];
  traits: string[];
  suggestedDurationMinutes?: number;
  componentHints: GeoEntityHint[];
  evidenceKeys: string[];
  shortReason: string;
}
```

There is no structural `kind`.

Rules:

- only supplied evidence may support candidates/components;
- no trusted coordinates/provider IDs/URLs from LLM memory;
- single-component Experiences are valid;
- multi-stop Experiences are valid;
- component order only when evidence supports it;
- ROUTE component only when evidence establishes a real route/street/path/corridor;
- all prompts/raw output/parsed validation go to Bitácora.

# GeoEntity resolution and DestinationScope

Reuse the current resolution/provider separation rather than rewriting it blindly. Preserve provider/externalId/canonicalName/coords/geometry/admin context/evidence where useful, but materialize `GeoEntity`, not `Activity`.

Remove the current dead-end where missing destination boundary skips validation/materialization. Support:

```text
DestinationScope = PolygonScope | PointRadiusScope
```

A degraded point/radius destination must continue through acquisition.

# Experience validation

Validation occurs before routing:

```text
ExperienceCandidate
→ Evidence validation
→ GeoEntity resolution
→ geographic validation
→ VerifiedExperienceCandidate
```

Single component:

```text
required entity resolved + destination-compatible
```

Multi component:

```text
all required entities resolved + destination-compatible + geographically coherent
```

Simple visit of a clearly visitable/touristic `PLACE` may be admitted from trusted geo-provider evidence without requiring a page literally saying “visit X”; do not convert arbitrary parking/ATM/offices to Experiences.

Routing provider downtime must never make an already verified Experience unverified.

# Experience dedupe

Run after resolution/validation and before persistence.

Retrieve possible duplicates using destination/scope + shared GeoEntities and/or vector similarity, then classify conservatively:

```text
SAME
NEW
AMBIGUOUS
```

Strong identity signals:

- essential action/concept;
- essential component overlap;
- intrinsic order/route structure;
- intrinsic mobility when materially identity-bearing;
- semantic identity.

Do NOT use title, description, quality score, status, evidence count, source or most traits/themes as identity by themselves.

`SAME` enriches existing evidence/traits/metadata and re-embeds when canonical semantic document changes. `AMBIGUOUS` must not auto-merge. False-positive merge is worse than a temporary duplicate.

# Ranking and embeddings

Embeddings belong primarily to Experience matching. Build the document from canonicalName, description, themes, traits, essential component names and destination context; avoid dumping raw evidence text when it adds noise.

Ranking can combine semantic similarity, themes/traits, exclusions, quality, proximity/logistics, exploration style and diversity.

Remove kind/family/variant/ExperienceFormat slot reservations and caps.

Trace score breakdown in Bitácora.

# Deterministic planner boundary

Keep/reuse the current deterministic planning/solver logic where responsibilities remain valid, but migrate its input/output to Experiences.

Conceptual candidate:

```text
PlanningExperienceCandidate
- experienceId
- title
- durationMinutes
- startFootprint
- endFootprint
- openingHours?
- semanticScore
- qualityScore?
- traits[]
- mobility summary?
```

Remove `ActivityKind`, `ExperienceFormat`, familyId, variantTheme from planner contracts.

Persist selected results as `TourExperience` + component snapshots.

Delete/replace `TourFormatCoverageValidator` with informational/scorable `TourIntentSatisfaction`; it must not be a hard structural kind gate.

Again: **NO LLM itinerary planner.**

# Routing V2

Implement only after Experience verification + deterministic selection are functional.

Internal routing: between components within a selected Experience.

External routing: between consecutive selected Experiences in a Tour, plus outbound/return for origin-bound trips when needed.

Evidence-backed `GeoEntity ROUTE` is canonical/domain evidence. Provider-generated LineString/path is derived logistics. Do not confuse them.

Trace provider/mode/from/to/hints/result/timing/failure.

# Async / Outbox architecture — preserve

Do not redesign the operational model:

```text
POST /tours
→ transaction: Tour PENDING + Outbox(TourGenerationRequested)
→ Outbox publisher
→ durable queue
→ idempotent TourGeneration worker
→ Experience catalog/acquisition/ranking/planning/routing
→ Tour COMPLETED
```

Preserve duplicate-delivery idempotency, interrupted-generation recovery, retry semantics, progress and push notifications, and atomic Tour+Outbox creation.

For catalog acquisition, use the same durable async patterns where appropriate.

# Media/image enrichment — preserve semantics

Move visible media ownership to Experience while retaining current hardened behavior:

```text
FOUND
AUTHORITATIVE_EMPTY
RETRYABLE_FAILURE
PERMANENT_FAILURE
```

Rules:

- store image URLs/metadata, not image files;
- 429/5xx/network/timeout is retryable and must not poison negative cache;
- authoritative empty may populate negative cache;
- media failure never fails Experience or Tour;
- Tour cover enrichment remains independent where already modeled.

# Increment order / checkpoints

Use small reviewable commits. Suggested sequence:

```text
A docs(trace): define Experience V2 architecture and Bitacora V3
B refactor(db): introduce GeoEntity and Experience domain model
C refactor(geo): materialize resolved providers into GeoEntity
D feat(experiences): add verified experience catalog
E refactor(discovery): discover grounded experiences instead of activity kinds
F refactor(ai): extract grounded ExperienceCandidate records
G refactor(validation): verify experiences from evidence and geography
H feat(experiences): deduplicate grounded experience acquisition
I feat(experiences): materialize verified experiences and enqueue enrichments
J refactor(tours): express intent as constraints and experience preferences
J2 feat(tours): support origin-bound open-destination experience discovery
K refactor(tours): acquire verified experiences with local-first coverage
L refactor(ranking): rank Experience candidates by intent and semantic fit
M refactor(planner): schedule verified Experiences deterministically
N feat(routing): separate internal experience and external tour routing
O refactor(async): preserve durable tour generation on Experience V2
P refactor(media): enrich Experience image URLs without blocking generation
Q feat(bitacora): expose Experience V2 search AI validation and routing audit
R refactor(domain): remove legacy ActivityKind composite model
```

Temporary compatibility adapters may exist only to keep incremental compilation and must be removed by R.

# Required acceptance scenarios

1. Single `PLACE`: MALBA → persisted verified “Visitar MALBA”; one snapshot component; no internal route.
2. San Telmo grounded walk: evidence-backed ordered components; verified before routing; internal routing only after selection; full Bitácora.
3. Two materially different official San Telmo walks remain distinct despite overlapping themes/area/stops.
4. Gualeguaychú 2-day run no longer fails because a requested structural NEIGHBORHOOD_WALK kind is absent; it succeeds when enough feasible Experiences exist.
5. Buenos Aires + tango with weak local coverage triggers tango-specific grounded acquisition.
6. Rediscovered existing Experience → `SAME`, no duplicate Experience row, new evidence/enrichment allowed.
7. Point-radius destination continues through discovery/resolution/validation/materialization/planning.
8. Routing unavailable does not change Experience VERIFIED status.
9. Media provider 429 → retryable, no negative-cache poison, Tour/Experience remain valid.
10. Authoritative empty media → valid negative cache, no retry storm.
11. Duplicate `TourGenerationRequested` delivery remains idempotent.
12. Bitácora reconstructs queries, evidence, exact LLM prompts/raw output, parsing, validation, entities, dedupe, ranking, deterministic planning, routing and async failures with zero secrets.
13. “No quiero lugares religiosos, quiero comida vegana” becomes structured exclusions + positive intent; Experiences with required religious components do not reach planner.
14. Admin can populate Mendoza broadly with no Tour associated; verified/deduped Experiences persist; media URLs/embeddings enrich asynchronously.
15. A later Mendoza Tour with sufficient local coverage does not require grounded search.
16. A custom long-tail preference missing locally triggers focused acquisition and permanently enriches the catalog.
17. Buenos Aires → Tigre same-day uses normal Tigre Experiences and accounts for outbound/return as Tour travel.
18. Open “day trip from Buenos Aires” performs origin-bound/open-destination Experience discovery; destinations emerge from resolved GeoEntities.

# Repo-native test commands

Use the real scripts after inspection. Current Makefile provides:

```bash
make dev-start
make dev-stop
make dev-build
make test-unit
make fe-web-e2e
make test-e2e
```

After each logical increment: focused tests, then `make test-unit` before commit. Run Prisma validate/generate after schema changes. Run relevant E2E checkpoints. At the end run build/typecheck/lint according to actual package scripts.

Never claim tests/CI are green unless actually executed/confirmed.

# Coding-agent execution rules

1. No big-bang without checkpoints.
2. Preserve working async/outbox/media/provider infrastructure where responsibility is still valid.
3. Do not preserve ActivityKind semantics merely for code reuse.
4. Do not add provider-specific fields to domain contracts.
5. Do not invent new fallback chains unless required by this plan or demonstrated by current implementation.
6. Do not create Experiences from LLM latent knowledge.
7. Do not use routing as verification evidence.
8. Do not trust LLM coordinates/provider IDs as authoritative.
9. Dedupe conservatively.
10. Do not hard-fail because a preferred trait/theme is absent.
11. Do not break Outbox/idempotency/media failure semantics.
12. Every relevant AI/search invocation must appear in Bitácora V3.
13. Every trace must pass centralized secret redaction.
14. Never reset a DB before explicit safety verification.
15. Keep `docs/architecture/activity-discovery-and-tour-generation.md` synchronized with implemented architecture.
16. Delete superseded generation paths in the same delivery sequence; do not leave permanent fake Experience→ActivityKind translation.

# Definition of Done

The refactor is done when:

- Tour generation no longer depends functionally on `ActivityKind`;
- every schedulable item is an `Experience`;
- physical POIs are `GeoEntity PLACE`;
- AREA/ROUTE are geographic primitives, not Experience kinds;
- visiting one PLACE is a persisted Experience;
- discovery has no target Activity kind;
- free-text preferences are normalized by LLM but enforced deterministically;
- verification is evidence + geo resolution/coherence;
- routing happens after verification/selection and is split internal/external;
- dedupe is conservative and enriches rediscovered Experiences;
- admin/manual population can fill a city without a Tour;
- Tour generation is local-catalog-first and grounded search occurs only on real coverage gaps;
- grounded-search-per-tour declines as catalog maturity grows;
- day trips use origin-bound/open-destination geographic intent, not a new Experience kind;
- deterministic planner uses Experience IDs;
- Tour persists TourExperience + component snapshots;
- async Tour generation remains Outbox/queue-backed;
- media enrichment remains eventual/retryable/non-fatal and stores URLs only;
- Bitácora exposes exact prompts/raw responses/query fan-out/decisions without secrets;
- canonical architecture doc matches implementation;
- legacy Activity composite domain is removed;
- required acceptance scenarios pass.
