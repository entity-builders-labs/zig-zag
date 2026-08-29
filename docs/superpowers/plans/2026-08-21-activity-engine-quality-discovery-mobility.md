# Activity Engine: Candidate Quality, Discovery, and Mobility Implementation Plan

> **Status:** Active incremental plan. PRs 1-2 are integrated in the local
> `codex/main`; PR 3 is open as GitHub PR #19 and remains unmerged pending the
> local acceptance gate and explicit maintainer approval. The repository
> remains the source of truth.
>
> **Baseline:** local `codex/main` at `eacfaf7`, which includes the completed
> destination-resolution work and the canonical architecture document.
>
> **Canonical design:** read
> [`docs/architecture/activity-discovery-and-tour-generation.md`](../../architecture/activity-discovery-and-tour-generation.md)
> before implementing any PR in this plan. The repository remains the source
> of truth for current behavior.

## Goal

Turn the current grounded-but-low-quality tour pipeline into a provider-aware,
quality-gated Activity Engine that:

1. queries the existing catalog first and distinguishes reusable knowledge from
   a new/stale destination that still needs bounded hybrid bootstrap;
2. retrieves Activities that match the user's interests without losing hard
   geographic constraints;
3. refuses to treat a large but irrelevant pool as sufficient coverage;
4. discovers sourced must-see POIs, areas, routes, and composite experiences
   through a replaceable search-grounded provider when destination knowledge
   or an explicit coverage dimension is missing;
5. resolves every proposed entity through Google Places or OSM before
   persistence;
6. selects Activities that form transport-feasible groups per day; and
7. returns per-leg mode, estimated time, and distance while delegating live
   navigation details to Google Maps.

This plan supersedes neither the completed destination-resolution plan nor its
commits. It begins from that implementation and addresses the next set of
problems exposed by a real local generation for Sevilla.

## Architecture decision: hybrid destination knowledge (2026-08-23)

The Santa Fe smoke test invalidated the assumption that a large, clean Places
refill is sufficient evidence of tourism coverage. The run persisted 51 rows,
yet only one item from a reasonable ten-place visitor benchmark existed in the
local catalog. Conversely, a simple Google Search grounded answer identified
the canonical museums, civic center, cultural venues, bridge, and historic
sites immediately.

The corrected design does **not** make grounded LLM output the universal entry
point. It assigns explicit jobs:

```text
catalog           reuse verified knowledge and personalization
Places Text       retrieve/resolve conventional POIs by intent or exact name
Places Nearby     secondary bounded coverage for one missing type/zone
grounded Discovery propose sourced must-see meaning, areas and experiences
OSM/Overpass      resolve authoritative areas, streets, routes and membership
```

For an already-profiled healthy destination, the catalog remains first and no
external provider is required. For a new or stale destination, one bounded
bootstrap may contrast Places Text Search candidates with grounded
`ActivityProposal` results even when the raw catalog count is high. The result
is resolved, validated, cached/reused destination knowledge; discovery is not
repeated for every tour. A later request may invoke only the operation matching
its concrete deficit.

Grounded proposals are never authoritative identity. Citations and raw output
remain evidence; every POI/venue resolves through Places and every
area/street/route through OSM with destination context before persistence.
This decision removes global OSM-neighborhood enumeration/ranking and broad
multi-anchor Nearby crawling from the **target discovery path**. Existing
anchor and admission primitives remain useful for bounded Places coverage.
Exact-membership and boundary-hydration primitives move to targeted proposal
resolution and are introduced only with an immediate production consumer. The
transitional global neighborhood selector is deleted; it must not survive as a
hidden fallback or evolve into a hand-built tourism recommendation engine.

## Why this plan exists: the Sevilla failure

Tour `92a322ed-383d-4819-ba8b-5af287dd6940` exposed a systemic failure that
unit tests based only on call wiring did not catch:

- the requested destination point was `37.3890924,-5.9844589`;
- the city boundary's bounding-box center was
  `37.37658075,-5.9260377`, approximately 5.3 km east;
- the single Places refill used that bounding-box center with a 5 km cap;
- the refill therefore concentrated on Sevilla Este rather than the historic
  center and persisted 110 results;
- the 15 offered results included empty names and places with no rating,
  review count, opening hours, or embedding;
- saving embeddings failed because the active fallback used an invalid OpenAI
  key, but the crawl still reported success;
- the bitacora said embeddings were used even though 0/15 candidates were
  indexed;
- concurrent Overpass work produced repeated 429 responses and timeouts, so
  only four OSM nodes survived;
- the Wikidata safety prompt failed to format because literal JSON braces were
  interpreted as LangChain variables; and
- the anti-hallucination guard correctly chose only real IDs, but those real
  IDs came from a bad candidate set: `Cerveceria Bar Juanlu` and
  `Plaza Eugenia Osuna Ansio`.

The lesson is an invariant for every PR below:

```text
Grounded does not mean relevant.
Numerous does not mean sufficient.
Provider success does not mean usable coverage.
```

## Scope and sequencing rules

- Each implementation branch starts from the latest local `codex/main`.
- Each PR is reviewed and tested independently. It remains on its feature
  branch until the local acceptance gate below is complete and the maintainer
  explicitly approves merging it into `codex/main`.
- Do not let Activity Discovery persist or enter generation until entity
  resolution, validation, and provenance are reliable. The provider-neutral
  proposal/bootstrap contract may be implemented earlier, because an
  unprofiled destination is itself a coverage state; raw output still cannot
  compensate for provider failures or pollute the catalog.
- Do not start transport-aware itinerary generation until CoverageAnalyzer can
  produce a stable eligible pool. Spatial optimization cannot repair bad
  entities.
- All provider calls degrade explicitly. Embedding providers never fall back
  to another provider; a same-provider retry may be bounded, after which the
  engine continues without semantic signals and reports that state truthfully.
  Other documented fallbacks may reduce functionality, but must not falsely
  report that a signal was applied.
- LLM input windows and maximum-output reservations must fit the configured
  provider's request/TPM budget. Candidate blocks are inserted exactly once;
  increasing a provider limit is not a substitute for deterministic prompt
  budgeting.
- Do not mix embeddings from different provider/model/version combinations.
- No free-form discovery output is persisted.
- No QID is required for eligibility. Wikidata is optional narrative
  enrichment only.
- Do not merge speculative or superseded code. A replacement PR must delete
  the old execution path, obsolete tests/providers, and dependency wiring in
  the same delivery sequence. Temporary loss of new composite creation is
  acceptable while existing verified catalog composites remain reusable.

## Mandatory delivery and local acceptance gate for every PR

No implementation PR in this plan may be merged into local `codex/main` merely
because it compiles or its happy path works. The following gate applies to PRs
1 through 12:

> **Temporary CI operation (2026-08-23):** the repository's GitHub Actions
> quota is exhausted, so remote checks are not awaited before merge. This does
> not relax the gate below: the complete applicable test/check/build commands
> must pass locally, the acceptance report must record their results, and the
> maintainer must still approve the merge explicitly. Restore remote checks as
> an additional gate when quota is available again.

1. **Branch isolation**
   - create the PR branch from the latest accepted `codex/main`;
   - keep the branch unmerged while it is being evaluated;
   - do not stack the next implementation PR on an unaccepted branch.
2. **Unit tests are part of the change**
   - every new or changed production behavior must have a corresponding unit
     test in the same PR;
   - every bug fix must include a regression test that fails before the fix;
   - tests must cover success, rejection/validation, provider failure or
     degraded behavior, and important boundary conditions;
   - assertions must verify outputs and decisions, not only calls or trace
     stage existence;
   - code with no meaningful executable behavior, such as documentation or a
     mechanical schema declaration, must still be covered through the nearest
     affected service/serialization test when runtime behavior changes.
3. **Automated local verification**
   - run the focused Jest unit suites while developing;
   - before presenting the PR, run
     `yarn workspace backend run test --runInBand`,
     `yarn workspace backend run check`, and
     `yarn workspace backend run build` (the explicit `run` matters for
     Yarn 1's built-in `check` command);
   - run the relevant backend integration/E2E suite whenever the PR crosses a
     database, HTTP, provider-adapter, or tour-generation boundary;
   - run frontend checks/tests too when the persisted contract or UI changes.
4. **Multi-case local functional verification**
   - exercise at least one normal case, one degraded/failure case, and one
     regression case specific to that PR;
   - for destination/candidate/generation behavior, use more than one
     destination scale or city when relevant, rather than validating only the
     original Sevilla example;
   - automated provider tests use deterministic fixtures or strict-cache mode;
     bounded live-provider smoke tests are additional evidence, never the sole
     test;
   - inspect both the resulting tour/candidates and the bitacora so a plausible
     final response cannot hide a wrong provider, fallback, or score path.
5. **Acceptance report and explicit merge decision**
   - present the changed behavior, test files, exact commands, pass/fail
     results, manually exercised cases, trace observations, and known limits;
   - leave the PR branch unmerged so the maintainer can reproduce or inspect
     it locally;
   - merge into `codex/main` only after the maintainer explicitly confirms that
     the PR works locally;
   - if any required case fails, fix and repeat the whole affected gate before
     requesting approval again.

The acceptance report for each PR should use this compact template:

```text
PR branch / commit:
Behavior covered:
Unit tests added or changed:
Automated commands and results:
Local cases exercised:
Bitacora/result observations:
Known limitations:
Merge approval: pending | approved
```

## Incremental quality-delta protocol

Every PR must state one falsifiable quality hypothesis before implementation
and demonstrate its delta with the same request, catalog state, provider
fixtures/cache, and configuration before and after the change. A different or
already warmed catalog is not a valid comparison.

For every benchmark case, retain these artifacts in the acceptance report or
an explicitly referenced fixture/report:

```text
wizard input and resolved DestinationContext
catalog precondition: cold | warm plus relevant row/embedding counts
provider, cache schema/mode, and live call count by operation
ordered eligible candidate IDs with score/evidence breakdown
CoverageReport and degraded/unavailable signals
generation bitacora
final selected Activity IDs, day/order, and composite waypoints
```

Use three layers of evidence:

1. **Deterministic regression fixture:** proves the decision and exact boundary
   conditions without paid/live providers.
2. **Controlled local integration case:** uses an isolated/scoped database
   state and strict cached provider responses so before/after runs are
   reproducible.
3. **Bounded live smoke case:** records a new provider response once in cache,
   then replays it strictly. Live calls are never run by the default automated
   suite and remain within the PR's explicit provider budget.

Quality includes correctness, relevance, feasibility, and truthful degradation.
A foundational PR does not need to make the UI prettier, but it must improve an
observable engine decision or remove a false claim. No PR may claim quality
improvement from a final itinerary alone when its candidate pool, provider
evidence, or trace contradicts that claim.

### Expected visible quality ladder

| PR  | Quality hypothesis that must be observable before merge                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Places acquisition produces geographically valid conventional POIs without weak one-review/type-only junk; Text Search and Nearby retain explicit roles, and anchors are never presented as tourism relevance. PR 3 does not claim complete must-see coverage. |
| 4   | The wizard and backend distinguish themes, desired experience formats, allowed transport, and daily/continuous walking limits; changing one dimension changes only its intended engine constraint.                                                             |
| 5   | Changing interests changes semantic ordering within the same eligible destination pool; provider/model mismatch or failure is visibly unavailable and never mixes vectors.                                                                                     |
| 6   | A large irrelevant or spatially unusable pool no longer counts as sufficient; `CoverageReport` also distinguishes profiled/fresh from stale/unprofiled destination knowledge and names exact deficits.                                                         |
| 7   | A new/stale destination bootstrap or explicit qualitative/experience deficit launches grounded Discovery; sourced proposals are traced but cannot persist directly. A healthy profiled destination makes no unnecessary grounded call.                         |
| 8   | Resolved proposals become valid reusable Activities/composites; unresolved or incoherent hints are rejected with reasons and cannot pollute the catalog.                                                                                                       |
| 9   | The generated tour can select from one verified catalog/discovery pool while unknown IDs, duplicates, and invalid waypoint subsets remain impossible.                                                                                                          |
| 10  | The same candidates produce different coherent daily sets when walking, cycling, driving, or public transport or walking tolerance changes; distant semantic matches no longer form an infeasible day.                                                         |
| 11  | Every same-day transition exposes an allowed selected mode and defensible time/distance estimate, while live navigation details remain a Maps handoff.                                                                                                         |
| 12  | Cold and warm end-to-end scenarios preserve all prior improvements under success and degraded-provider conditions without hidden fallback, dead transitional flow, or catalog corruption.                                                                      |

For PR 3, the fixed regression matrix starts with:

- **Cordoba cold:** no alphabetical zero-evidence neighborhood selection and no
  one-review/type-only junk in the admitted or offered pool;
- **Sevilla cold:** central prominent attractions are not missed because one
  arbitrary bounding-box-center circle sampled the east of the city;
- **Mendoza cold:** empty/generic identities such as `Arquitectura` are not
  newly persisted, and anchors are not described as relevant neighborhoods;
- **warm repeat:** provider call count is zero when the admitted catalog
  satisfies the refill precondition, with no duplicate Activities;
- **OSM unavailable:** Google refill still succeeds, no approximate
  neighborhood is invented, and no speculative composite is created.

The deterministic fixtures cover the full matrix. Only a small explicitly
selected subset needs a live recording; all browser repetitions use the saved
cache or the warm catalog.

## Explicit non-goals for this sequence

- turn-by-turn navigation inside Zig-Zag;
- persisted public-transit line or stop instructions;
- real-time traffic or disruption monitoring;
- destinations larger than a city/town/village;
- a new `GeoFeature` table;
- replacing `ActivityWaypoint` with provider-specific geometry rows;
- a broad rewrite into a new `ActivityEngine` module before behavior is stable;
- deleting existing catalog data as part of migrations.

## Target PR chain

The PR sequence implements one five-stage operating model. The stages are the
stable product architecture; individual algorithms and providers remain
replaceable implementation details:

```text
1. Resolve context
   intent + mobility + authoritative destination

2. Build a verified candidate pool
   catalog first -> inspect destination-knowledge state -> choose direct
   Places resolution, Text Search, bounded Nearby, grounded bootstrap, or
   explicit gap Discovery -> resolve and validate before reuse

3. Select coherent daily sets
   semantic relevance + quality + diversity + mode-aware travel cost

4. Route and schedule each day
   deterministic travel time + activity duration + opening-hour constraints

5. Verify, snapshot, persist, and respond
   canonical IDs + tour legs + effective composite waypoints + bitacora
```

Catalog Refill, Activity Discovery, OSM composite construction, and narrative
enrichment are conditional zooms into stage 2. They are not mandatory network
calls on every generation. PRs 1-2 establish stage 1 and cross-cutting truth;
PRs 3-9 establish the user-intent contract, stage 2, and the semantic part of
stage 3; PRs 10-11 complete stages 3-5; PR 12 validates the full flow.

```text
PR 1  Provider identity, cache isolation, and truthful trace
  -> PR 2  Destination normalization, Wikidata, and Overpass reliability
  -> PR 3  Safe Places acquisition/admission primitives (not tourism authority)
  -> PR 4  Tour intent + mobility contract and wizard
  -> PR 5  Embedding integrity and hybrid catalog retrieval
  -> PR 6  CoverageAnalyzer, destination-knowledge state, and quality gate
  -> PR 7  Provider-neutral grounded bootstrap and Activity Discovery (done)
  -> PR 7.1 Grounded search/extraction evidence separation (done)
  -> PR 7.2 Tour completeness validation and under-filled itinerary guard (done)
  -> PR 8  Proposal entity resolution and safe persistence (done)
  -> PR 9  Unified pool selection and generation integration
  -> PR 10 Transport-aware spatial feasibility
  -> PR 11 MVP per-leg transport contract and Maps handoff
  -> PR 12 End-to-end acceptance, rollout, and cleanup
```

An OSM infrastructure track may proceed after PR 2 without renumbering the
domain PR chain. It is a production gate before PR 12: normal mass-production
tour requests must not depend on the public Nominatim or Overpass community
instances. The track covers an opt-in local Docker profile, a self-hosted or
managed production query backend, and asynchronous destination refill.

---

## PR 1: Provider identity, cache isolation, and truthful trace

### Objective

Make it impossible for the application, logs, cache, bitacora, or persisted
source provenance to claim Google when Geoapify was used, or to claim a signal
was applied when it was unavailable.

### Required changes

1. Introduce a validated backend Places provider value:
   `google | geoapify`. Reject unknown values during configuration rather than
   silently treating them as Google.
2. Select `google` as the MVP catalog-refill provider in the documented local
   and production configuration. Keep `IPlacesApiService`; do not hardwire the
   Google adapter into tour generation.
3. Make the cache namespace include at least:

   ```text
   provider + cache schema version + method + normalized params
   ```

   A Google response must never be returned from a Geoapify namespace or vice
   versa.

4. Rename misleading runtime concepts where feasible:
   `buildGooglePlacesCrawlStep` should become provider-neutral, and the trace
   label should report `Google Places`, `Geoapify`, or `cache` explicitly.
5. Return request provenance from the cached adapter:

   ```text
   provider
   cacheStatus: hit | miss-live | strict-miss
   requestedCount
   receivedCount
   acceptedCount
   rejectedCountByReason
   ```

6. Document cache modes accurately:
   - `read`: cache first, live provider on miss, no write;
   - `write`: cache first, live provider on miss, then write;
   - `strict`: cache only, fail on miss.
7. Add a startup log and health/debug surface containing provider names and
   availability without exposing API keys.

### Likely files

- `be/src/modules/integrations/integrations.module.ts`
- `be/src/modules/integrations/google-places/services/cached-places-api.service.ts`
- `be/src/modules/integrations/google-places/google-places.service.ts`

- `be/src/modules/tours/utils/generation-trace-builder.util.ts`
- `be/src/modules/tours/interfaces/generation-trace.interface.ts`
- `.env.example`
- integration module and cache service specs

### Tests and acceptance

- A cache entry written under Google is never read under Geoapify.
- `read` mode calls the selected real provider on a miss.
- `strict` mode performs no external call.
- The trace for a Geoapify run never says Google Maps.
- A failed Overpass lookup is not reported as a successful empty streets or
  boundary result; generation may continue, but the trace is degraded.
- Startup fails clearly for `PLACES_PROVIDER=unknown`.
- No test logs or snapshots expose API keys.

---

## PR 2: Destination normalization, Wikidata, and Overpass reliability

### Objective

Make destination-area resolution, optional enrichment, and OSM exploration
fail predictably without turning provider labels or provider pressure into
arbitrary point fallbacks and neighborhood selection.

### Destination normalization changes

1. Do not use the frontend display label as the only Nominatim query. Build a
   bounded fallback from structured locality and country components while
   retaining the original query for auditability.
2. Use the wizard's selected coordinates and country to disambiguate candidate
   city/town/village results. Do not blindly accept `results[0]` and do not
   strip arbitrary middle components from every comma-separated label.
3. Record attempted query forms, selected result, and point-scale degradation
   reason in the trace without exposing unrelated provider payloads.
4. Preserve the point-scale behavior for selected addresses and specific POIs;
   normalization must not turn every selected place into a city-wide tour.

### Wikidata changes

1. Escape literal JSON braces or construct the safety prompt without
   `PromptTemplate.fromTemplate` interpolation hazards.
2. Add a test that formats the real production prompt before mocking the model;
   a mock returning JSON is insufficient because it bypasses the observed
   failure.
3. Distinguish in the trace:

   ```text
   withoutQid
   fetched
   acceptedSafe
   rejectedUnsafe
   providerFailed
   safetyCheckFailed
   ```

4. Keep candidates with no QID or failed enrichment. Only their optional
   narrative context is absent.
5. Never copy an unverified Wikidata extract directly into persisted Activity
   prose.
6. Because content safety and itinerary generation can consume the same Groq
   TPM window, retry one transient 429 using the provider's bounded delay.
   Do not retry indefinitely or hide the final provider error.

### Overpass changes

1. Limit live use in this phase to destination boundary resolution and
   structurally valid child-area centers used as independent Places coverage
   anchors. Do not enumerate streets/POIs or rank neighborhoods to invent
   composites during itinerary generation.
2. Add retry policy for 429/502/503/504 with bounded exponential backoff,
   jitter, `Retry-After` support, and a total request/time budget.
3. Default the shared public instance to conservative concurrency. The current
   limiter bounds in-flight calls but does not reduce the total queued burst or
   retry rate-limited calls.
4. Add a circuit breaker for the current generation: after the budget is
   exhausted, mark OSM coverage unavailable and continue with catalog
   candidates rather than enqueueing more calls.
5. Preserve the relative `admin_level = city + 1` rule and reject highway ways
   masquerading as administrative areas. An OSM center is only an anchor; it
   is never treated as a containment polygon.
6. Keep detailed street/POI and exact-membership queries out of the live path
   until PR 8 has a grounded proposal and a concrete entity-resolution
   consumer for them.
7. Before interest ranking, lazily backfill only retrieved legacy catalog
   candidates whose pgvector value is null (currently at most 20). Normal
   provider ingestion remains the eager embedding path; this is a bounded
   repair, not a full per-tour reindex.

### Operational boundary and local OSM support

PR 2 makes public-provider use bounded and honest; it does not turn a public
community endpoint into production capacity. Add or plan an opt-in
`osm-local` Docker Compose profile backed by a persistent volume and a small
regional OSM extract. It must not run as part of the default developer stack
or silently download a planet-scale database.

Before mass-production rollout:

1. Configure a self-hosted or managed Nominatim-compatible geocoder and
   Overpass-compatible query backend with an operational SLA.
2. Move cold-destination OSM acquisition into a deduplicated asynchronous job
   keyed by destination OSM identity.
3. Materialize validated OSM identities as reusable `Activity`,
   `ActivityFamily`, and `ActivityWaypoint` rows; do not add `GeoFeature` for
   this purpose.
4. Make catalog reuse the normal request path. Per-tour Overpass exploration
   is a cold-start/refill behavior, not the steady-state scaling strategy.
5. Keep the public instances limited to development, spikes, and explicitly
   bounded smoke tests.

### Likely files

- `be/src/modules/tours/services/destination-resolution.service.ts`
- the destination input/context contract used by tour generation
- matching destination-resolution specs and Nominatim fixtures
- `be/src/modules/integrations/wikidata/utils/wikidata-content-safety.util.ts`
- `be/src/modules/integrations/osm/services/overpass-api.service.ts`
- `be/src/modules/integrations/osm/services/cached-overpass-api.service.ts`
- `be/src/modules/integrations/osm/utils/overpass-concurrency.util.ts`
- `be/src/modules/integrations/osm/utils/overpass-query.util.ts`
- `be/src/modules/tours/services/tour-activity-generation.service.ts`
- matching specs

### Tests and acceptance

- The provider label `Montevideo, Montevideo Department, Uruguay` resolves to
  the real Montevideo city boundary when its structured locality/country and
  selected coordinates identify OSM relation `2929054`.
- A selected address/POI remains point-scale after normalization.
- An ambiguous locality candidate inconsistent with the selected coordinates
  or country is rejected rather than accepted by result order.
- Literal JSON in the safety prompt formats successfully.
- Candidates without QIDs remain eligible.
- A 429 is retried within budget and recorded as degraded if exhausted.
- A Sevilla fixture cannot launch simultaneous detailed POI or street searches.
- Casco Antiguo/Triana centers remain available as bounded coverage anchors when another neighborhood
  fails.
- In the explicitly separate `generate-templates` curation command,
  placeholder OSM street names such as `Sin Nombre` and `Unnamed Road` never
  reach composite proposal or persistence.
- Places trace accounting separates rejected candidate results from provider
  request failures, so rejected results cannot exceed received results.
- Background activity generation uses a compact strict selection schema rather
  than asking the LLM to repeat names, coordinates, travel values, and tour
  totals already owned by the server. Verified IDs are rehydrated from the
  exact offered catalog candidates before spatial ordering and persistence;
  truncated or provider-rejected drafts are never salvaged.
- A successful explicit generation retry clears the previous attempt's error
  and failure timestamp instead of leaving contradictory completed+failed
  metadata.
- A live tour cannot create an OSM-backed composite from itinerary-LLM output.
  An existing verified catalog composite remains selectable and persists its
  effective `TourActivityWaypoint` snapshot unchanged.
- The default Docker stack does not download OSM data. An explicitly enabled
  local OSM profile documents its extract, disk use, initialization state,
  endpoint, and cleanup procedure.

---

## PR 3: Safe Places acquisition, bounded coverage, and catalog admission

### Objective

Replace the single bounding-box-center crawl with a bounded two-phase Google
Places acquisition plan that can retrieve relevant conventional POIs, cover an
explicit remaining type/zone gap, and admit only candidates with sufficient
provider evidence. Correct the Córdoba regression without treating Places
rank, OSM neighborhood names, distance to the center, or review count as proof
of a complete must-see list. PR 3 supplies safe acquisition primitives; the
grounded destination profile and experience-discovery role belongs to PR 7.

### Observed Córdoba regression and design correction

The first PR 3 smoke test proved the call cap, deduplication, boundary check,
persistence, and embedding path, but did not satisfy the product objective:

- `findNeighborhoodsWithin()` returned lightweight centers, while the
  shortlist attempted Polygon containment. Catalog coverage, prominence, and
  similarity therefore became false zeroes for every neighborhood.
- The no-evidence tie selected six neighborhoods alphabetically and reused
  them both as Places anchors and as composite areas.
- Nearby Search ranked by `DISTANCE`, and secondary-type matching plus the
  admission rule `one review OR trusted type` admitted user-generated or
  weakly evidenced places.
- The trace marked all 462 raw neighborhoods as offered even though only six
  were explored.

This is not fixed by a better tie-break. PR 3 must separate three decisions:

1. **Catalog acquisition:** which bounded provider operations retrieve useful
   conventional POIs.
2. **Geographic coverage:** which transient points distribute point-based
   Nearby calls across the destination.
3. **Composite validation scope:** which finite proposed/reusable OSM areas and
   waypoints can be proven to belong together. Transitional global area
   selection must fail conservatively and is not the target discovery path.

No service or value object may use one of these decisions as an undocumented
proxy for another.

### Responsibility boundaries and contracts

1. Rename/refine the transient anchor responsibility as
   `CatalogRefillAnchorPlanner`. `DestinationAnchor` remains a request value,
   not an Activity or persisted domain entity.
2. Add a provider-neutral `CatalogAcquisitionPlan` made of explicit operations:

   ```text
   operationId
   purpose: destination_seed | geographic_coverage | missing_category
   providerOperation: nearby | text
   requested types/query
   geographic constraint
   result budget
   ```

3. Keep provider capability differences explicit. A Google-only descriptive
   Text Search operation is skipped with truthful provenance when Geoapify is
   selected; it is never approximated silently or used to switch providers.

### Deferred from PR 3: targeted OSM membership

The Córdoba spike proved that exact parent-constrained point-to-area membership
is technically possible and that nearest-centroid/name matching is invalid.
However, the global neighborhood selector that consumed it has been superseded.
Therefore PR 3 does not ship an unused membership adapter or its fixture.
Targeted batch membership and boundary hydration are reintroduced in proposal
entity resolution, where a concrete grounded/reusable area supplies the finite
scope and the code has an immediate production consumer.

### Checkpoint B: structurally valid geography and independent anchors

1. Point-scale destinations retain one user/resolved point with a bounded
   radius.
2. Area-scale destinations always put the selected destination point first
   when it is inside the authoritative boundary.
3. Remaining coverage anchors come from structurally valid, real OSM child-area
   centers ordered by **POI density** (number of existing catalog POIs in each
   candidate's bounding box), then by proximity to the destination center as
   tie-break. This replaces the earlier farthest-first k-center algorithm,
   which maximized geometric spread at the expense of tourism relevance —
   producing anchors in peripheral, low-tourism areas while skipping central
   ones. The algorithm must not use alphabetical order, tourism claims, or
   fabricated grid points.
4. Exclude administrative ways that are also `highway=*`; accept a way boundary
   only when it is a closed area. Deduplicate OSM identity before planning.
5. Keep the target at 4-8 total anchors only when that many authoritative
   points exist. Bound anchor radius, category count, results, total latency,
   and total provider calls.
6. These anchors mean geographic API coverage only. Their labels must never be
   presented as "relevant", "touristic", or "chosen for a composite".

#### Implemented Checkpoint B outcome (2026-08-23)

- `DestinationAnchorService` was replaced by the responsibility-specific
  `CatalogRefillAnchorPlanner`.
- Point-scale destinations still produce one bounded origin. Area-scale plans
  put the selected point first when it is inside the authoritative boundary.
- Remaining origins come from the structurally valid raw child-area set, not
  from a neighborhood relevance shortlist.
  POI-density ordering (descending by number of existing catalog POIs per
   candidate, tie-broken by proximity and id) selects them spatially rather
   than by farthest-first; input order and area name do not affect the plan.
  input order and area name do not affect the plan.
- OSM identity and coordinates are deduplicated before planning, centers
  outside the authoritative parent are rejected, and the plan returns fewer
  anchors when fewer authoritative points exist.
- The parent-area Overpass query now requests only `parent admin_level + 1`.
  Relations remain supported; ways require `boundary=administrative`, no
  `highway=*`, and Overpass `is_closed()`.
- The catalog-refill trace calls them geographic coverage points and explicitly
  says they do not imply tourism relevance or composite selection.

Unit coverage includes destination-first ordering, input-order-independent
POI-density ordering, OSM/coordinate deduplication, out-of-boundary rejection,
no fabricated quota, the eight-anchor cap, highway-way rejection, genuine
closed-area way support, and invalid parent metadata reported as unavailable.

### Checkpoint C: explicit tourism-oriented Google acquisition

Run two explicit phases inside the same total provider budget:

1. **Destination seed (Google capability):** one or more controlled Text Search
   operations such as `best places to visit in {locality}, {country}` and one
   controlled theme query selected from the requested interests. Use the
   resolved structured destination, a rectangular `locationRestriction`
   derived from its bounds where supported, and the exact backend
   Polygon/MultiPolygon check afterward. Text Search uses its singular
   `includedType` only when that one type is genuinely aligned with the whole
   query. A broad `museums, historic sites and cultural landmarks` query must
   not carry `includedType=museum`: Google documents that categorical Text
   Search almost always applies that filter even when
   `strictTypeFiltering=false`. It is a configured operation, never a Nearby
   failure fallback.
2. **Geographic coverage:** Nearby Search around the independent anchors using
   `includedPrimaryTypes`, not broad secondary `includedTypes`, for high-signal
   groups such as:
   - visitor landmarks: `tourist_attraction`, `historical_landmark`,
     `historical_place`, `cultural_landmark`, `monument`, `plaza`,
     `observation_deck`;
   - museums and arts: `museum`, `history_museum`, `art_museum`, `art_gallery`;
     include visitor-relevant cultural venues such as `cultural_center` and
     `performing_arts_theater` in the controlled cultural mapping;
   - architectural/visitor landmarks include supported types such as `bridge`
     when the current Places type table exposes them;
   - explicitly requested outdoor/entertainment/food groups through their own
     controlled mappings.
3. Request and retain `primaryType` in addition to `types`. Use
   `rankPreference=POPULARITY` for catalog acquisition unless an operation has
   a documented reason to use distance.
4. Group compatible primary types into one Nearby operation instead of spending
   one request per type. The round-robin scheduler shares the remaining budget
   across requested categories and anchors.
5. Search terms, type groups, operation purpose, selected provider, requested
   count, received count, and geographic rejection counts are typed provenance,
   not strings inferred later from logs.
6. Bump the Places cache schema when request/response semantics change. Old
   cached responses without `primaryType` cannot masquerade as evidence for the
   new policy.
7. Separate the type requested from the provider from the primary types that a
   flexible Text Search operation is allowed to admit. Nearby normally uses
   the same controlled list for both. A broad Text Search seed may omit
   `includedType` while carrying an explicit `admissiblePrimaryTypes` union;
   the validator must read that typed operation field rather than infer a
   broader contract from a category label.

Google Nearby officially supports `includedPrimaryTypes` and `POPULARITY`;
Google Text Search uses singular `includedType` plus optional
`strictTypeFiltering` and geographic restriction/bias. Keep the adapter and
tests aligned with those distinct APIs rather than exposing a misleading common
"type filter". Primary references:
[Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search),
[Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search),
and [Place Types (New)](https://developers.google.com/maps/documentation/places/web-service/place-types).

#### Implemented Checkpoint C outcome (2026-08-23)

- `CatalogAcquisitionPlan` now emits typed destination-seed and geographic-
  coverage operations. Google runs two controlled Text Search seeds followed
  by Nearby operations using grouped `includedPrimaryTypes` and `POPULARITY`.
- Text Search uses singular `includedType`, explicit `strictTypeFiltering`, and
  a destination rectangle when an authoritative boundary exists; otherwise it
  uses the bounded first-anchor circle. Every response receives the backend
  operation-geography check, and area-scale candidates still receive exact
  destination Polygon/MultiPolygon validation before persistence.
- The remaining call budget traverses the anchor-by-category matrix
  diagonally, so tight budgets distribute work geographically and thematically
  instead of exhausting the first anchor or category.
- `primaryType`, provider contact fields, acquisition purpose, operation ID,
  per-operation status, received counts, and geographic rejection reasons are
  retained. The Places cache schema is `v3`, so older responses cannot provide
  false primary-type evidence.
- Geoapify records the Google-only Text seeds as unsupported and does not call
  or approximate descriptive Text Search. Its supported category operations do
  not consume budget for those skipped seeds.
- Planner and validator consume one centralized catalog acquisition taxonomy;
  a provider result cannot be admitted through a category different from the
  operation that produced it.
- The Rosario smoke test exposed a separate destination-normalization defect:
  Nominatim matched the overqualified English provider label to `Puente Nuestra
Señora del Rosario` about 10 km from the selected city point. Fine-grained
  forward results now need tight point consistency before suppressing reverse
  normalization, while city boundaries keep the wider centroid tolerance. The
  normalized reverse path resolves the real Rosario city relation, and the
  existing exact-point behavior remains covered.

#### Checkpoint C acceptance gap found in the Santa Fe smoke test (2026-08-23)

The first live Santa Fe run proved that operation count and clean persistence
are not enough. Google Places persisted 51 rows, but only one of a reasonable
ten-place visitor benchmark (Museo de la Constitución Nacional) existed in the
local catalog. Plaza 25 de Mayo, Manzana Jesuítica, Convento de San Francisco,
Museo Etnográfico Juan de Garay, Museo Rosa Galisteo, Teatro Municipal, El
Molino, La Redonda, and Puente Colgante were absent rather than merely ranked
below the top 15.

This is not a production name allowlist. It is a live quality-evaluation set
that exposed two general defects: the mixed culture/history seed was narrowed
by `includedType=museum`, and the controlled type vocabulary did not cover
important cultural-center, theater, and bridge identities. Before Checkpoint C
is accepted as a **Places primitive**:

- keep the same maximum of two seed calls and the same total provider-call
  budget; improve query/type semantics rather than increasing calls;
- add deterministic fixtures containing the relevant primary-type families
  plus commercial/institutional distractors;
- run bounded cold-catalog smoke reports for Santa Fe and at least two other
  cities, recording which benchmark entities were returned, rejected, or
  admitted and through which operation. PR 3 is not required to recover every
  benchmark entity by itself; the later hybrid bootstrap acceptance compares
  Places-only recall with the resolved union;
- do not claim that Places alone establishes the definitive list of
  “imperdibles”. Grounded recommendation belongs to Activity Discovery and
  every resulting POI proposal still requires exact Places/OSM resolution.

The generation trace now names Text Search and Nearby Search separately and
reports succeeded, skipped-for-capability, and failed operations. It does not
describe Text Search as a fallback.

### Checkpoint D: union, admission, and persistence

1. Union all seed and coverage results and deduplicate by provider + external
   ID before persistence.
2. Split admission into two explicit pure/testable policies coordinated by the
   write gate:
   - `CatalogIdentityValidator`: normalized name, provider ID, finite
     coordinates, operation radius, destination boundary, operating status,
     primary/supported type, and address-only rejection;
   - `CatalogAdmissionPolicy`: sufficient evidence that the real provider
     entity is useful enough to enter the reusable catalog.
3. `CatalogAdmissionPolicy` must provide named evidence paths rather than
   `reviewCount > 0 OR trusted type`:
   - review-backed confidence evaluated by an explicit category policy; or
   - a supported institutional primary type corroborated by structured provider
     data such as official website, phone, or opening hours.
     A requested type, Text Search rank, perfect one-review rating, or provider
     type alone is not admission evidence.
4. Keep policy parameters centralized, justified, included in the trace, and
   covered by boundary-value fixtures. PR 3 defines write admission; PR 6 later
   defines read-side tour eligibility and ranking, so persistence alone never
   guarantees selection.
5. The complete structural rules still include:
   - non-empty normalized name;
   - provider ID present;
   - finite coordinates;
   - inside the resolved destination boundary for area-scale;
   - not permanently closed (`CLOSED_PERMANENTLY` or normalized
     `PERMANENTLY_CLOSED` only; do not confuse this with closed now, opening
     hours, holidays, or a temporary closure);
   - supported/mappable type;
   - no obvious address-only or unnamed feature;
   - minimum admission evidence appropriate to the provider and category.
     The complete rule-to-rejection mapping is the canonical contract in
     `docs/architecture/activity-discovery-and-tour-generation.md`, section
     **Catalog candidate validation contract**. Keep code, unit tests, trace
     labels, and that table synchronized when a rule changes.
6. Preserve structural and admission rejection reasons in the trace. Do not
   collapse `unsupported_primary_type`, `insufficient_review_confidence`, and
   `missing_institutional_corroboration` into an unauditable generic count.
7. Do not silently count rejected rows as catalog coverage.
8. Persist only admitted real POIs and generate their canonical embeddings
   before the catalog is re-queried.
9. Keep provider provenance, `primaryType`, supporting provider fields, and
   external identity accurate. Do not drop website/phone already returned by
   the initial Places response merely because a separate Details call was not
   requested.
10. Do not create POIs from streets, paths, or neighborhood boundaries.

#### Implemented Checkpoint D outcome (2026-08-23)

- The write gate now coordinates two pure policies:
  `CatalogIdentityValidator` owns structural truth, operation/destination
  geography, status, supported type, and primary-type/category consistency;
  `CatalogAdmissionPolicy` owns reusable-catalog evidence.
- Google review-backed confidence uses centralized inclusive boundaries:
  visitor landmarks `rating >= 4.0 && reviews >= 50`; museums/arts
  `4.0 && 20`; outdoor `4.1 && 50`; food and nightlife `4.2 && 100`;
  entertainment `4.0 && 100`.
- A supported institution that misses its category review boundary is admitted
  only when provider data corroborates it through website, phone, or opening
  hours. A type alone is insufficient. Geoapify uses its explicit available-
  evidence path: mapped operation category, provider types, and a formatted
  address; it does not inherit Google ratings or primary types.
- Exact rejection reasons include `unsupported_primary_type`,
  `insufficient_review_confidence`,
  `missing_institutional_corroboration`, and
  `insufficient_provider_evidence`. Identity-valid and admitted counters are
  distinct from persisted and embedded counts in provenance and trace.
- Unit boundaries prove that a perfect one-review landmark, 49-review
  landmark, and sub-threshold rating are rejected; the inclusive 4.0/50
  visitor boundary passes. Review-sparse institutions require structured
  corroboration.
- Website, phone, opening hours, `primaryType`, provider types, operation ID,
  purpose, and external identity are preserved from the initial Places result
  when available; a Details call is not required merely to avoid dropping
  fields already returned.

#### San Juan corrective checkpoint outcome (2026-08-23)

The cold San Juan run returned a materially better final set and exposed three
contracts that are now implemented, while PR 3 remains unmerged pending its
final browser smoke and maintainer acceptance:

1. Nominatim may represent the correct nearby settlement as a `node` with
   `addresstype=city` while its usable containment polygon is a separate
   administrative relation. Destination identity and boundary geometry must
   be resolved as two explicit steps: accept the coordinate-consistent city
   identity, hydrate and validate one containing relation, and degrade as
   `boundary_unavailable` when that cannot be proven. Do not globally promote
   every `state_district` or pretend that a node is a polygon. The trace must
   not report `candidate_mismatched_coordinates` when identity matched but
   boundary hydration was the missing operation.
2. The trace must implement the canonical counter contract already documented
   in the architecture: raw seed/coverage receipts, operation-geography
   rejection, result deduplication, identity-valid, admitted, existing,
   newly persisted, and embedded. `admitted` must not read as though every
   admitted candidate was a new insert.
3. Type consistency must prevent a broad supported primary type from masking
   a more specific unsupported identity. In particular, a result returned as
   `park` but also typed as `campground`/`lodging` must not enter the generic
   outdoor visitor pool unless that experience type is explicitly supported.
   This remains a finite provider-type rule with fixtures, not a place-name
   blacklist.

Subtype diversity (for example many churches) and temporary-closure
eligibility belong to PR 6's read-side quality gate. They are not reasons to
erase an otherwise real reusable entity during PR 3 write admission, but they
must prevent a saturated or unavailable candidate pool from being treated as
a good tour.

The corrective regression suite proves node-settlement boundary hydration,
no-match/provider-failure degradation, structured Nominatim container mapping,
unambiguous acquisition counters, admitted-existing versus newly persisted
rows, and the generic-park/campground type conflict. A bounded live resolver
check resolved San Juan's settlement node to the containing `Capital` relation,
kept Rosario on its direct city relation, and preserved an exact Casa Rosada
POI as point-scale without invoking Places.

### Checkpoint E: remove speculative live composite creation

PR 3 must not leave the old city-wide OSM neighborhood enumeration as a hidden
fallback while the targeted discovery path is built:

1. Remove `CompositeAreaSelector`, the legacy neighborhood relevance shortlist,
   their dependency wiring, and tests that assert global barrio selection.
2. Stop creating new composites by enumerating raw child areas and asking the
   itinerary LLM to invent a walk from arbitrary streets.
3. Remove the live itinerary prompt's `compositeActivities`, `osmFeatures`, and
   `area` creation channel. The itinerary response selects existing Activity
   IDs only, including existing verified composites.
4. Continue querying and selecting existing verified catalog composites.
5. Audit the explicit `generate-templates` CLI separately. Keep it only if it
   remains a supported curation workflow with its own honest contract; it must
   not leak back into live generation or masquerade as grounded Discovery.
6. Do not ship the currently unused exact-membership batch adapter/fixture in
   PR 3. Reintroduce that capability with the targeted proposal resolver.
7. The trace states that composite discovery was not requested/available; it
   does not expose hundreds of OSM barrios or fabricate a substitute walk.
8. Remove obsolete methods, DTO fields, maps, mocks, and documentation in the
   same change. No indefinite feature flag or unreachable compatibility branch
   is an acceptable completion state.

### Trace contract

1. OSM child-area centers used for Places coverage are internal acquisition
   inputs, not activity candidates; do not label them considered, offered,
   explored, or touristically relevant.
2. Report only their bounded aggregate use and provider status. Do not
   serialize raw OSM neighborhoods into the candidate list.
3. Distinguish acquisition purposes and counters:

   ```text
   seed operations / coverage operations
   requested / received / outside operation geography
   deduplicated / structurally valid / admitted / persisted / embedded
   composite discovery not requested / unavailable
   ```

4. Semantic/provider failure is `unavailable`; absence of the removed global
   selector is not presented as zero neighborhood evidence.

### Likely files

- `be/src/modules/tours/services/catalog-refill-anchor-planner.service.ts`
- `be/src/modules/activities/services/catalog-candidate-validator.service.ts`
- new catalog admission policy and evidence types
- `be/src/modules/integrations/google-places/google-places.service.ts`
- Google/Geoapify provider interfaces, adapters, cache schema, and fixtures
- `be/src/modules/tours/services/tour-activity-generation.service.ts`
- OSM query builder/service structural filtering used by destination and anchor
  resolution only
- trace builder and tests

### Tests and acceptance

- Córdoba cold-catalog acquisition never creates `2 de Abril`, `2 de mayo`,
  `20 de Junio`, etc. as speculative composite areas.
- The destination seed returns prominent central cultural candidates in its
  deterministic Google fixture; Nearby coverage remains independently
  distributed and bounded.
- Nearby requests use tested primary-type groups and `POPULARITY`; Text Search
  is a separately traced operation with singular `includedType` semantics.
- A Geoapify run never executes or pretends to approximate the Google-only
  descriptive Text Search seed.
- An OSM center is never treated as a containment polygon. No unused batch
  membership path remains in PR 3.
- Administrative highway ways are rejected as neighborhoods; a fixture for a
  genuinely closed administrative way remains supported.
- No globally enumerated composite area appears as offered/explored in the
  bitacora; existing catalog composites remain eligible.
- An empty name is rejected and never persisted.
- Duplicate Places results from multiple anchors create one Activity.
- A high-rated result outside the city boundary is rejected.
- A permanently closed result is rejected, while a result that is merely
  closed at the current time is not treated as permanently closed by the
  catalog validator.
- Address-only, unsupported-type, missing-ID, invalid-coordinate, generic-name,
  unsupported-primary-type, insufficient-review-confidence, and missing-
  corroboration results are rejected with their exact reason in the trace.
- A `museum` type with no reviews and no structured institutional evidence is
  rejected; a real institutional fixture with corroborating official provider
  fields is admitted.
- A one-review user-created attraction is rejected without adding a
  name-specific blacklist.
- Point-scale behavior remains one point + bounded radius.
- Mixed interests do not let the first category exhaust the provider-call
  budget before every selected category has been attempted across the anchors.
- The trace distinguishes fetched, accepted, deduplicated, rejected, and
  embedded counts.
- The resulting Córdoba candidate window contains no blank names and excludes
  the known weak smoke-test fixtures; the acceptance report records admitted
  primary types and evidence paths.

### Post-implementation fix: cross-category admission for multi-typed places (2026-08-26)

**Found live-testing PR 7.2** against San Miguel de Tucumán: the city's single
most iconic landmark, Casa Histórica - Museo Nacional de la Independencia
(where Argentine independence was declared, 1816), never reached the real
catalog despite Google Places returning it correctly (`primaryType:
"history_museum"`, rating 4.7, 38,587 reviews — far above any candidate that
was being admitted).

**Root cause**: `CatalogIdentityValidator`'s `unsupported_primary_type` check
compared a Text Search candidate's type only against the single acquisition
category of whichever operation happened to return it first. Exact-`placeId`
deduplication upstream (`google-places.service.ts`) keeps only one operation's
copy of a place returned by multiple seed queries — an arbitrary,
non-deterministic race, not a reflection of the place's real type. Casa
Histórica's surviving copy was attributed to the broad `visitor_landmarks`
Text Search (`tourist_attraction, historical_landmark, ..., church` — no
`history_museum`), even though its real type is squarely accepted under
`museums_and_arts`. A well-known place spanning multiple legitimate categories
(the common case for genuinely important landmarks — exactly what makes them
likely to surface in *several* seed queries at once) was penalized for which
query happened to win the dedup race.

**Fix**: `CatalogCandidateValidationContext` gained `requestedInterests?:
string[]`. For Text Search operations, `CatalogIdentityValidator` now checks
the candidate's type against the **union** of every acquisition category
covered by the request's interests (`INTEREST_ACQUISITION_CATEGORIES`), not
just the one operation's category — falling back to the original
single-category check when no interests map to a known category (preserves
prior behavior for untouched call sites, e.g. `CompositeGenerationService`'s
OSM-street acquisition). Nearby Search operations are unaffected — they
already carry their own explicit `requestedPrimaryTypes`, not a derived
category.

**Bitácora enhancement (same investigation)**: `PlacesCrawlProvenance` gained
a bounded `rejectedCandidates?: Array<{ id, name, reasons }>` — the trace
previously only aggregated rejections by reason count
(`rejectedCountByReason`), with no way to answer "which specific place got
dropped and why" without re-running the crawl with ad-hoc logging.
`buildPlacesCrawlStep` now surfaces rejected candidates in the bitácora
(`offered: false`) alongside admitted ones, capped at 50 entries
(`MAX_REJECTED_CANDIDATES_IN_TRACE`) to bound trace size.

**Live-verified**: reproduced end to end against the real local stack —
deleted the local Tucumán catalog, re-crawled Google Places fresh, confirmed
via the enhanced bitácora that Casa Histórica was rejected for
`unsupported_primary_type` after surviving dedup under `visitor_landmarks`;
applied the fix; re-crawled again; Casa Histórica was admitted; regenerated
the tour; it was selected in the final itinerary alongside the museum and
restaurant already found in earlier testing.

Implemented files: `catalog-candidate-validation.interface.ts` (modified —
`requestedInterests`), `catalog-identity-validator.service.ts` (modified —
`resolveAcceptablePrimaryTypes`), `catalog-identity-validator.service.spec.ts`
(new), `google-places.service.ts` (modified — `recordRejectedCandidate`,
threads `requestedInterests` through), `google-places.service.spec.ts`
(modified), `places-api.interface.ts` (modified — `rejectedCandidates`),
`generation-trace-builder.util.ts` / `.spec.ts` (modified — surfaces rejected
candidates in `buildPlacesCrawlStep`).

---

## PR 4: Tour intent, mobility contract, and wizard

### Objective

Let the user state what kinds of experiences they want and how much physical
travel they accept without overloading `interests`, `transportationMode`, or
the generic pace slider. This PR changes the frontend and backend contract
together; it does not add a second compatibility DTO or retain a legacy wizard
submission path.

### Canonical request dimensions

```ts
interface TourIntent {
  interests: string[];
  experienceFormats: Array<
    "point_visits" | "neighborhood_walks" | "thematic_routes" | "experiences"
  >;
  explorationStyle: "iconic" | "balanced" | "local_deep_dive";
  additionalPreferences?: string;
}

interface MobilityPreferences {
  allowedTransportationModes: TransportationMode[];
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  travelPace: TravelPace;
  accessibilityNeeds?: string[];
}
```

The names above are the intended API semantics; final enum spelling must follow
the repository's naming conventions. `interests` remains the thematic signal
used by embeddings. `experienceFormats` drives requested Activity kinds and
Discovery/Coverage deficits. `transportationMode` says which modes a later
route planner may choose. Walking limits are hard deterministic constraints,
not prompt prose. `additionalPreferences` is bounded supplemental intent, not
an alternate raw prompt and not a source of trusted entity identity.

### Wizard behavior

1. Add an experience-format step with plain-language choices such as landmark
   visits, neighborhood walks, thematic routes, and other experiences. Do not
   present the internal `ActivityKind` enum directly.
2. Keep themes/interests separate. “History” describes subject matter;
   “neighborhood walk” describes delivery format.
3. Replace the ambiguous physical meaning of the pace-only control with a
   walking-effort profile: minimize walking, moderate, enjoys walking, or
   custom. Show the resulting approximate kilometers per day.
4. Capture a maximum continuous walking leg independently from the daily sum.
   A user may accept 6 km spread across a day but reject one uninterrupted
   3 km transfer.
5. Apply distance limits per day, not across the whole tour. The same profile
   must behave consistently for one-day and multi-day requests.
6. Keep `travelPace` as the speed/density preference affecting visit duration
   and schedule slack; do not reinterpret it as a distance budget.
7. Define accessible, versioned product presets in one shared contract. Do not
   duplicate magic kilometer values between React state, DTO defaults, prompts,
   and route utilities.
8. The wizard submits the new canonical contract only. Remove obsolete state,
   comments, casts, DTO aliases, prompt fields, and tests instead of keeping a
   parallel legacy payload.
9. Replace the currently disconnected `specialNotes` state with
   `additionalPreferences` in the canonical payload. Trim it, enforce one
   centrally defined length limit, persist it, and show it as `captured` in the
   bitacora. Structured fields remain authoritative; free text cannot override
   hard mobility/accessibility constraints or assert a trusted Activity.
10. Preserve a provider-neutral destination-scale hint from the selected
    autocomplete result: settlement versus specific point (POI, address, or
    equivalent). Google/Geoapify response types are mapped at the adapter
    boundary and do not leak into the tour domain. This prevents reverse
    normalization from silently widening a selected point into its containing
    city when Nominatim cannot resolve the same fine-grained label.

### Engine wiring in this PR

- Normalize the request once into typed `TourIntent` and
  `MobilityPreferences` value objects.
- Persist/trace the normalized values with the Tour generation request so later
  PRs consume stable input.
- Feed `interests` to current semantic/prompt behavior without claiming that
  new format or distance constraints are already enforced.
- Include `additionalPreferences` exactly once in the canonical intent passed
  to current itinerary selection. Persist and trace it now; PR 5 consumes it
  in the semantic query and PR 7 consumes it only through explicit coverage or
  discovery deficits. It never enters Places/OSM as authoritative identity.
- Feed `experienceFormats` into a typed desired-kind requirement available to
  CoverageAnalyzer/Discovery in later PRs.
- Feed walking budgets into a typed mobility profile available to spatial
  feasibility in PR 10.
- The bitacora must distinguish `captured` from `enforced`. Until PR 10, it may
  report that walking limits were captured but deterministic routing is not yet
  active; it must not claim the final tour obeyed them.

### Tests and acceptance

- Frontend interaction tests prove themes, experience formats, modes, daily
  walking budget, continuous-leg limit, pace, and additional preferences
  serialize independently.
- Backend DTO/value-object tests reject empty modes, negative/NaN distances,
  continuous limits above the daily limit, unknown formats, and over-limit
  additional preferences.
- A wizard note is present in the canonical request, stored generation intent,
  bitacora, and final-selector input exactly once; removing it changes each of
  those artifacts. It does not affect Places acquisition or entity identity in
  this PR.
- Selecting walking as transport does not automatically request a
  `NEIGHBORHOOD_WALK`.
- Selecting a neighborhood walk does not increase the walking-distance budget.
- A selected address/POI remains point-scale even when Nominatim cannot
  resolve the same fine-grained label; a settlement hint still requires a
  verified settlement identity and boundary rather than trusting autocomplete.
- Changing from a one-day to a three-day tour does not multiply the per-day
  value inside a single day's feasibility input.
- The API/controller/service path has one canonical payload and no legacy
  branch after the PR.
- Browser smoke: create two otherwise identical requests, one with point visits
  only and one with neighborhood walks; the bitacora shows different requested
  kinds while clearly stating that route enforcement arrives in PR 10.

### Implemented PR 4 checkpoint

- The browser submits one nested provider-neutral contract. The old wizard
  prompt/flat-coordinate payload and its unused DTO were removed.
- Google and Geoapify autocomplete types map at the adapter boundary to
  `settlement | specific_point`; a specific point bypasses city widening.
- The backend validates and normalizes the contract once, persists it as
  `metadata.generationRequest`, and background generation reads only that
  value.
- The bitacora has an explicit intent/mobility stage. Walking limits are
  reported as captured, not deterministically enforced.
- Additional preferences are bounded, trimmed, persisted, traced, and included
  exactly once in selector input.
- Backend DTO/service/trace tests and a browser request-capture test cover the
  contract dimensions independently.

### Known weakness found live-testing PR 7.2 (2026-08-26): exclusion preferences in free text are unreliable across models

`additionalPreferences` is free text with no structured way to express a hard
exclusion ("no churches", "nothing religious") — it reaches the LLM as one
more sentence in the user prompt, with no elevated priority over the rest of
the intent. Tested the exact same request (San Miguel de Tucumán,
history+food, moderate, `additionalPreferences: "No quiero nada de iglesias,
nada religioso."`) against four provider/model combinations:

| Model | Included a church anyway? | Notes |
|---|---|---|
| `llama3.2:3b` (Ollama, Docker CPU-only) | Yes | never completed — 5 min timeout |
| `llama3.2:3b` (Ollama, native macOS/Metal) | Yes | completed, but also hit the duration-string bug below |
| `qwen2.5:7b-instruct` (Ollama, native) | Yes | `aiReasoning` falsely claimed religious sites were excluded |
| `openai/gpt-oss-120b` (Groq) | **No** | correctly excluded, `aiReasoning` matched the actual result |

Only the largest model (Groq's 120B) reliably honored the exclusion; both
local models (3B and 7B) included a church every time despite the explicit
instruction, one of them while incorrectly asserting compliance. This is a
model-capability-scale problem, not something PR 7.2's density/retry logic
or the PR 3 admission fix can address — both of those worked correctly
across all four combinations tested.

**Deferred fix direction (not scheduled yet)**: give the wizard a dedicated,
structured place for hard restrictions/exclusions, separate from open-ended
`additionalPreferences` — something the deterministic pipeline (candidate
filtering, `CoverageAnalyzer`, prompt composition) can actually act on
instead of relying entirely on smaller models correctly parsing free-text
negation. Needs its own design pass; not part of PR 7.2 or this PR 4
checkpoint.

**Also found in the same investigation, already fixed**: `transformAiActivitiesToDto`
now coerces a unit-wrapped duration string (e.g. `"2.5 hours"`, observed from
`llama3.2`) into the plain Float hours value `TourActivity.duration` expects,
instead of crashing persistence — Groq's strict `json_schema` mode never hit
this, but nothing guarantees every provider honors the schema equally.
Native Ollama on Apple Silicon also needed `OLLAMA_BASE_URL=http://host.docker.internal:11434`
(not `http://ollama:11434`, which stays correct for the Docker Compose
`ollama` service) to reach Metal-accelerated inference from inside the
backend container — Docker's CPU-only `ollama` service timed out on the same
prompt that native Ollama completed in seconds.

---

## PR 5: Embedding integrity and hybrid catalog retrieval

### Objective

Make embeddings a reliable, model-consistent retrieval signal rather than a
best-effort re-rank of a rating-truncated list.

### Embedding integrity

1. Introduce `SemanticActivityDocumentBuilder` and use it for every Activity
   embedding path. Include verified semantic content:
   name, description, kind, themes/type, area name, duration, and verified
   waypoint names/types for composites.
2. Exclude identity and volatile quality data from semantic text:
   coordinates, external IDs, rating counts, and provider IDs.
3. Track embedding identity on each Activity or in an equally enforceable
   index contract:

   ```text
   provider
   model
   dimensions
   documentVersion
   embeddedAt
   ```

4. Remove cross-provider embedding fallback completely. If the configured
   Ollama, Bedrock, or OpenAI provider fails, `AiEmbeddingService` must not
   initialize or invoke another provider even when another API key is present.
   It returns an explicit unavailable/degraded state. A provider/model change
   is an operator-controlled configuration change and requires a full rebuild.
5. Change embedding writes to return a typed result or throw. Callers must know
   which IDs were indexed; `saveActivityEmbedding()` must not swallow failure
   and let the crawl claim success.
6. Add an explicit degraded state when embeddings are unavailable or the
   configured index identity mismatches stored vectors.
7. Keep production on Bedrock Titan Text Embeddings V2 at 256 dimensions until
   a coordinated schema migration and full rebuild are approved.
8. Record semantic ranking as `requested`, `applied`, or `unavailable` from the
   actual query result. A nonzero indexed-row count reports availability only;
   it does not prove that the query embedding provider responded or that a
   similarity score affected ordering.

### Hybrid retrieval

1. Build a canonical semantic query from interests/themes and desired
   experience style. Do not use destination identity as a substitute for the
   hard geographic scope.
2. Apply hard eligibility first:
   resolved destination, not archived, kind != AREA, required accessibility,
   and deterministic constraints that are already known.
3. Run pgvector similarity within the eligible destination pool. Do not select
   the rating/distance top 20 first and only then score those IDs.
4. Retrieve a broad bounded candidate pool, then apply quality, distance,
   kind/source balance, and diversity signals.
5. Existing `POI`, `ROUTE`, `NEIGHBORHOOD_WALK`, and `EXPERIENCE` Activities
   compete on a common score.
6. Missing embeddings are represented explicitly; they do not silently become
   evidence of zero user interest.
7. Consume PR 3 admission evidence as a quality input, not as semantic text.
   `primaryType`, review confidence, and institutional corroboration must not
   be embedded, and admission must not be interpreted as guaranteed tour
   eligibility.

### Likely files and schema

- new semantic document builder and tests
- `be/src/shared/ai/services/ai-embedding.service.ts`
- `be/src/shared/ai/services/vector-store.service.ts`
- `be/src/modules/tours/utils/candidate-ranking.util.ts`
- `be/src/modules/activities/services/activities.service.ts`
- `be/prisma/schema.prisma` and a reviewed migration if per-row identity fields
  are selected
- embedding rebuild command and tests

### Tests and acceptance

- Unit tests mock the Bedrock SDK and Ollama HTTP adapter; they require no AWS
  account, network, or locally running model.
- Local integration uses Ollama `nomic-embed-text` to generate 256-dimensional
  vectors and the same PostgreSQL+pgvector storage/query path used in
  production. ChromaDB is not introduced.
- Test Ollama success, startup failure, embed failure, and the presence of an
  unrelated `OPENAI_API_KEY`; no case may instantiate or invoke OpenAI unless
  `EMBEDDING_PROVIDER=openai` was explicitly selected.
- Test the equivalent Bedrock failures with a mocked SDK and prove that Ollama
  and OpenAI are not invoked.
- Before deploying the embedding pipeline in Zig-Zag's AWS environment, run
  one bounded live Bedrock smoke test there with the application's actual IAM
  identity. A local invocation is also valid only when it explicitly assumes
  that Zig-Zag identity; credentials belonging to another project provide no
  evidence about Zig-Zag's Bedrock access. Use an isolated index, clear it,
  and rebuild it entirely with Titan; do not mix it with Ollama vectors. This
  AWS validation is a deployment gate, not a blocker for accepting PR 5 after
  its mocked Bedrock tests and real local Ollama integration pass.
- Model-dependent smoke tests assert vector width, persistence, indexed count,
  query execution, and broad semantic sanity. Exact cross-model scores or
  rankings are not expected to match.
- A lower-rated relevant candidate outside the old rating top 20 can be
  retrieved.
- Mixed model/version vectors are excluded and reported.
- A failed embedding write is visible to the caller and trace.
- A provider switch cannot happen without an explicit rebuild.
- New accepted Places POIs are indexed before semantic coverage is evaluated.
- No-interests requests retain a deterministic quality/geography fallback.

### Implemented PR 5 checkpoint

- Activity vectors are generated only from the canonical semantic document;
  every write stores provider/model/dimensions/document-version identity.
- The configured provider is strict at startup and runtime. Failures are
  returned or traced explicitly, and no unrelated credential activates a
  fallback provider.
- Provider/model/document switches require the explicit full rebuild command;
  the migration invalidates legacy vectors whose identity cannot be proven.
- The current `vector(256)` schema rejects other configured dimensions, and a
  failed rebuild clears all partial batches before reporting the failure.
- Tour retrieval asks `ActivitiesService` for a bounded pool of up to 250
  geographically eligible, active, non-AREA Activities. pgvector scores that
  full pool before the 15-item itinerary window is selected.
- Missing/mismatched vectors remain an explicit unmeasured tier rather than a
  zero-interest score. The measured tier combines semantic relevance with
  bounded quality, proximity, kind, and subtype non-redundancy signals.
- Places refill reports the exact number of embeddings written and preserves
  write failure/unavailability in provenance.
- The bitacora records the actual semantic operation as `not_requested`,
  `applied`, or `unavailable`, with eligible/indexed/offered counts and active
  index identity when applicable.
- Unit coverage includes strict Bedrock/Ollama behavior, canonical documents,
  mixed-index exclusion, typed writes, full rebuild, and recovery of a relevant
  Activity beyond the old rating top 20.

---

## PR 6: CoverageAnalyzer and candidate quality gate

### Objective

Replace `MIN_SUFFICIENT_ACTIVITIES = 15` as the definition of success with a
typed coverage report that decides whether refill, discovery, or explicit
failure is appropriate.

### Deployable boundary (PR 6 vs PR 7)

PR 6 owns the deterministic catalog-quality gate and the typed coverage report
only. It does **not** persist destination-knowledge state and does **not**
execute grounded bootstrap/discovery; both remain PR 7 responsibilities. Until
PR 7 exists, destination knowledge is traced explicitly as unsupported in PR 6,
and the runtime stays on one final code path: catalog retrieval -> semantic/
quality ranking -> coverage analysis -> either proceed with a truthful
sufficient pool, retry the existing Places refill path for deployable deficits,
or fail explicitly before the itinerary LLM. No fake fresh profile, dormant
fallback path, or dead grounded branch is introduced in PR 6.

### Proposed contract

```ts
interface CoverageReport {
  status: "sufficient" | "insufficient" | "degraded";
  usableCandidateCount: number;
  requestedThemeCoverage: Record<string, number>;
  kindCoverage: Record<ActivityKind, number>;
  geographicCoverage: GeographicCoverageSummary;
  semanticCoverage: {
    indexed: number;
    eligible: number;
    strongMatchesByTheme: Record<string, number>;
    degradedReason?: string;
  };
  providerHealth: ProviderHealthSummary;
  destinationKnowledge: {
    status: "profiled_fresh" | "profiled_stale" | "unprofiled";
    profileVersion?: string;
    degradedReason?: string;
  };
  missing: CoverageDeficit[];
}
```

### Required behavior

1. Analyze only validated, eligible candidates.
2. Measure quantity relative to requested days, pace, and expected stops, not a
   global constant.
3. Require meaningful coverage for each requested theme, not only one strong
   overall match.
4. Measure kind/source diversity without requiring every kind.
5. Distinguish provider degradation from genuine destination scarcity.
6. Emit an acquisition decision, not one fixed fallback chain:
   - direct Places resolution for a named entity;
   - Places Text Search for a conventional POI deficit;
   - bounded Nearby only for a concrete missing type/zone;
   - grounded bootstrap when destination knowledge is unprofiled/stale;
   - grounded gap discovery for qualitative must-see, theme, area, or
     experience deficits.
7. A high catalog count does not suppress a required first destination
   bootstrap. A fresh healthy destination profile suppresses repeated grounded
   calls; ordinary gap discovery receives only the missing coverage.
8. Never send an unusable candidate pool to the itinerary LLM merely because
   every ID is real.
9. Add a trace stage containing the report and exact decision.
10. Keep the first spatial signal lightweight (distribution/density). Full
    transport feasibility arrives in PR 10 and then becomes part of coverage.
11. Report low-confidence iconic/composite-area coverage as a specific deficit
    that PR 7 may request from grounded discovery. Do not rerun geographic
    anchor planning as a substitute.

### Likely files

- new `be/src/modules/tours/services/coverage-analyzer.service.ts`
- new coverage interfaces/DTOs
- `TourActivityGenerationService`
- generation trace interfaces/builder and frontend bitacora rendering
- specs with deterministic candidate fixtures

### Tests and acceptance

- Fifteen irrelevant/unrated candidates are insufficient.
- A pool with 0 indexed candidates never claims semantic ranking was applied.
- The Montevideo regression pool of fifteen mostly monument/culture candidates
  is insufficient for `history + art + culture + architecture + beach` when
  meaningful art, architecture, or beach coverage is absent.
- A provider outage is `degraded`, not proof that a neighborhood has zero POIs.
- A conventional POI deficit chooses Places Text Search without forcing
  grounded Discovery.
- An unprofiled destination requests bounded hybrid bootstrap even when it has
  many weak/partial catalog rows.
- A fresh profiled destination with sufficient catalog coverage makes neither
  Places nor grounded calls.
- Discovery receives only the reported deficits.
- With no usable candidates, generation fails explicitly before the LLM call.

---

## PR 7: Provider-neutral Activity Discovery

**Status: Implemented (PR #23, merged 2026-08-25).**

### Objective

Create a bounded sourced destination profile for new/stale destinations and
discover missing POI, area, route, and experience concepts without giving the
model authority to create identities or coordinates.

### Domain contracts

```ts
type ProposalKind =
  | "POI"
  | "ROUTE"
  | "AREA"
  | "NEIGHBORHOOD_WALK"
  | "EXPERIENCE";

interface ActivityProposal {
  name: string;
  kind: ProposalKind;
  themes: string[];
  entityHints: EntityHint[];
  suggestedDurationMinutes: number;
  shortReason: string;
  groundingEvidence: GroundingEvidence[];
}

interface EntityHint {
  key: string;
  name: string;
  role: "area" | "waypoint" | "route" | "venue";
  expectedType: string;
}
```

### Required behavior

1. Introduce `SearchGroundedDiscoveryProvider` with a typed, provider-neutral
   request and response.
2. Implement one first grounded provider adapter behind configuration. Other
   adapters must not leak provider response shapes into the domain service.
3. `ActivityDiscoveryService` receives a `DestinationContext` plus one explicit
   mode from CoverageAnalyzer: bounded destination bootstrap, stale-profile
   refresh, or the exact `CoverageDeficit[]`. It never decides on its own to
   rediscover a healthy destination.
4. Enforce schema validation, controlled enums, maximum proposal/hint counts,
   duration bounds, evidence presence, and prompt-injection-resistant handling
   of search content.
5. `ActivityDiscoveryService` has no Prisma dependency and never persists.
6. Raw provider output and evidence references go to the trace/audit record,
   not directly into catalog prose.
7. Bootstrap and gap discovery may propose conventional POIs as well as
   composites. A POI proposal still requires exact Places resolution; grounded
   rank/citations are recommendation evidence, not a Place identity or catalog
   admission shortcut.
8. Grounded proposals may include `entityHints` with `role: area`. Resolve each
   finite hint through destination-constrained Nominatim/OSM lookup and
   authoritative boundary hydration. Do not enumerate/rank every raw city
   neighborhood as a prerequisite. The model supplies prominence evidence,
   never boundary geometry or identity.
9. Treat aliases such as `Montserrat`/OSM `Monserrat` as an explicit,
   destination-constrained resolution concern. Reject broad phrases such as
   `downtown`, out-of-destination homonyms, and unmatched names.

### Likely files

- new discovery interfaces and DTO schemas
- new `activity-discovery.service.ts`
- new provider token/config and first adapter
- tour module wiring
- unit tests using provider-neutral fixtures

### Tests and acceptance

- A fresh profiled request missing architecture and food composites asks only
  for those gaps.
- A new destination requests one bounded profile containing sourced must-see
  POI and experience proposals even when a Places row-count threshold is met.
- A healthy profiled destination makes no grounded call.
- Invalid kind, role, duration, or missing evidence rejects the proposal.
- Provider output containing coordinates/IDs does not become trusted identity.
- No Prisma create/update is reachable from discovery.
- Switching adapters does not change downstream proposal types.
- With an empty local catalog, grounded iconic-neighborhood hints affect the
  shortlist only when they resolve to offered in-destination OSM boundaries.
- An unresolved or ambiguous area hint is traced and rejected without causing
  an `AREA`, family, or composite to be persisted.

### Implemented files

```
be/src/modules/tours/interfaces/activity-discovery.interface.ts  (new)
be/src/modules/tours/services/activity-discovery.service.ts      (new)
be/src/modules/tours/services/activity-discovery.service.spec.ts (new)
be/src/modules/tours/services/groq-discovery.provider.ts          (new)
be/src/modules/tours/services/groq-discovery.provider.spec.ts     (new)
be/src/modules/tours/tours.module.ts                              (modified)
be/src/modules/tours/services/tour-activity-generation.service.ts (modified)
be/src/modules/tours/interfaces/generation-trace.interface.ts     (modified)
be/src/modules/tours/utils/generation-trace-builder.util.ts       (modified)
```

---

## PR 7.1: Grounded search/extraction evidence separation

**Status: Implemented, 2026-08-26.**

### Objective

Correct two gaps found testing PR 7 against real travel evidence: (1) the
extraction step could not be trusted not to invent its own "evidence" since
search and extraction were one combined step, and (2) `NEIGHBORHOOD_WALK`'s
hint-count handling conflated a domain claim ("a walk has at most N stops")
with a technical safeguard against runaway LLM output. Both are corrected
without starting PR 8 persistence work.

### Required behavior

1. Split discovery into two provider-neutral interfaces:
   `GroundedSearchProvider.search()` gathers real evidence and owns it
   exclusively; `SearchGroundedDiscoveryProvider.discover(request,
   searchResult)` performs structured extraction and may only reference
   evidence the search step actually returned. `ActivityDiscoveryService`
   calls them in that order and never runs extraction when
   `groundingStatus !== 'applied'`.
2. Two `GroundedSearchProvider` implementations exist behind the same
   interface: `GroqGroundedSearchService` (Groq's `browser_search` tool) and
   `SerpApiGroundedSearchService` (Google Search results via SerpApi — a
   plain search API, not an LLM, so it never competes with the extraction
   model's own token/rate quota). `SerpApiGroundedSearchService` is the
   current default binding for `GROUNDED_SEARCH_PROVIDER`; swapping back to
   Groq's is a one-line change in `tours.module.ts`. SerpApi's free tier is
   250 searches/month — a paid plan or a different provider is required
   before this can be a production default at scale.
3. `EntityHint` gains its own `evidenceKeys: string[]`, distinct from
   `ActivityProposal.evidenceKeys`: the proposal's keys support the overall
   concept, an entity hint's keys support that specific entity or its
   relationship to the proposal. A required hint with no `evidenceKeys`, or
   one referencing a key the search step never supplied, rejects the whole
   proposal — the same all-or-nothing strategy already used for every other
   structural validation error. Optional hints are not required to carry
   evidence.
4. `NEIGHBORHOOD_WALK`'s "at least 2 additional hints" domain rule is
   unchanged, but the global entity-hint-count ceiling is renamed to
   `MAX_DISCOVERY_HINTS_PER_PROPOSAL` and documented as a technical safeguard
   against runaway LLM output — not a claim that a walk may only have N
   stops. A walk with 6+ additional hints is valid as long as it stays under
   that technical cap.

### Tests and acceptance

- A search failure (`unavailable`/`failed`/`no_usable_evidence`) never
  reaches the extraction step and never fabricates proposals.
- A `NEIGHBORHOOD_WALK` with more than 5 additional hints is accepted;
  exceeding `MAX_DISCOVERY_HINTS_PER_PROPOSAL` is still rejected.
- A required entity hint with no `evidenceKeys`, or an unknown evidence key
  at the entity-hint level, rejects the proposal; a required hint with valid
  `evidenceKeys` is accepted; optional hints may omit evidence.
- A waypoint or route hint inside a `NEIGHBORHOOD_WALK` can carry evidence
  distinct from the proposal's own `evidenceKeys`.
- Live-verified against real APIs (Salta, Argentina, `history` theme):
  SerpApi returned 8 real search results; Groq extraction produced 6
  geographically coherent proposals, each citing only real supplied evidence
  keys, with a `NEIGHBORHOOD_WALK` correctly carrying distinct
  `evidenceKeys` on its area hint versus its waypoint hints.

### Implemented files

```
be/src/modules/tours/interfaces/activity-discovery.interface.ts        (modified — EntityHint.evidenceKeys)
be/src/modules/tours/services/groq-discovery.provider.ts               (modified — prompt, validation, MAX_DISCOVERY_HINTS_PER_PROPOSAL)
be/src/modules/tours/services/groq-discovery.provider.spec.ts          (modified)
be/src/modules/tours/services/activity-proposal-resolution.service.spec.ts (modified — fixture-only, compiles against the widened interface)
be/src/modules/tours/services/serpapi-grounded-search.service.ts       (new)
be/src/modules/tours/services/serpapi-grounded-search.service.spec.ts  (new)
be/src/modules/tours/tours.module.ts                                   (modified — SerpApi default binding)
be/src/shared/ai/ai.config.ts                                          (modified — serpApiKey)
be/src/commands/scripts/commands/try-discovery.command.ts              (new — manual smoke test against real APIs)
```

Not touched by this PR: `GroqGroundedSearchService` (kept, unused as the
current default but still registered and tested — the alternate
implementation the provider-neutral design is meant to allow), and all PR 8
persistence work.

---

## PR 7.2: Tour completeness validation and under-filled itinerary guard

**Status: Implemented, 2026-08-26.**

### Objective

Close a real product gap found live-testing PR 7.1: a generated full-day
tour could complete with only a couple of short activities even when a
large, valid candidate pool remained mostly unused, because nothing in the
pipeline asks "did the result make reasonable use of the requested day?".
`CoverageAnalyzer` (PR 6) only judges whether the offered *candidate pool*
is good enough; anti-hallucination verification only judges whether the
LLM's picks are real and non-duplicated. Neither notices a valid,
non-duplicated itinerary that is simply too thin.

### Required behavior

1. One shared, provider-independent `TOUR_PLANNING_POLICY_PROMPT`
   (`prompts/tour-planning-policy.prompt.ts`) carries every live prompt's
   planning semantics — verified-candidate-only selection, intent matching,
   geographic coherence, opening hours, day-completeness/density guidance
   (soft per-pace guidelines: relaxed 2-4, moderate 3-5, fast 4-7 substantial
   activities), meal handling, multi-day balance, and "prefer an honest
   lighter itinerary over padding" — composed into each of the three live
   prompts (`CREATE_TOUR_SELECTION_JSON_SYSTEM_PROMPT`,
   `CREATE_TOUR_JSON_SYSTEM_PROMPT`, `CREATE_TOUR_SYSTEM_PROMPT`) with only
   its own output contract appended. No prompt hand-copies the policy text;
   a test asserts all three literally contain the shared constant.
2. A new deterministic `TourCompletenessValidator` runs after anti-
   hallucination verification, independent of `CoverageAnalyzer` and of it.
   For each requested day (1..`requestedDays`, including a day the LLM
   omitted entirely), it sums "meaningful hours" and counts "substantial"
   activities (duration >= 45 min), capping a non-food-focused meal's
   contribution so a long lunch alone can't make a thin day look complete.
   A day is flagged `UNDERFILLED_DAY` only when it clears neither the
   per-pace hours nor count floor *and* the tour still has unused viable
   candidates (a global count — the system has no deterministic per-day
   candidate assignment yet, so a genuinely exhausted pool is never
   flagged). `isFoodFocusedIntent` is deliberately narrow: only a single
   `'food'` interest, not food-alongside-other-themes — full food-role
   scheduling stays deferred to PR 10's existing "Deferred follow-up" note.
3. An under-filled result triggers exactly one corrective regeneration:
   the itinerary LLM is re-invoked with deterministic, real-data-only
   feedback (day, activity count, hours, unused-candidate count) appended
   to the prompt, then verification/audit/completeness all re-run on the
   new response. Never looped further.
4. `generationStatus` stays `'completed'` even if the retry is still
   under-filled — that status means the generation *process* finished, not
   that every quality gate passed (documented explicitly in code at the
   point it's set). The shortfall stays visible via a new `tour_completeness`
   trace step and a top-level `generationTrace.tourCompleteness` field
   (`{ complete, issues, retryAttempted }`) — no new persisted status enum.
5. Fixed a related, previously undiscovered bug: `Activity.duration` /
   `TourActivity.duration` are hours (`prisma/schema.prisma`), but both live
   candidate-formatting call sites (`activity-prompt-formatter.util.ts`,
   `tour-generation.service.ts`'s `/tours/nearby` fallback) labeled the same
   number "minutes" to the LLM. Corrected at both call sites — needed for
   the density guidance and the validator to reason in consistent units.

### Tests and acceptance

- Pure unit coverage in `tour-completeness-validator.service.spec.ts`:
  under-filled vs. complete via long composites, meal capping with and
  without food-focused intent, relaxed vs. fast pace density, an exhausted
  pool never flagged, multi-day issues isolated to the affected day, and a
  fully-omitted day still flagged.
- Retry-loop coverage in `tour-activity-generation.service.spec.ts`:
  exactly one retry on an under-filled first attempt, the retry's result
  (not the first attempt's) persisted, and no second retry when the retry
  itself is still under-filled.
- `create-tour.prompt.spec.ts` asserts all three live prompts literally
  contain `TOUR_PLANNING_POLICY_PROMPT` and state the real
  `relaxed`/`moderate`/`fast` density guidance.
- Live-verified against the real local stack: the exact destination/intent
  combination that originally reproduced the bug (San Miguel de Tucumán,
  history+food, moderate, 1 day, 27 eligible candidates) went from a
  2-activity itinerary to a 3-activity, 5.5-meaningful-hour itinerary on the
  first attempt (no retry needed), with `tourCompleteness.complete: true`
  in the persisted trace.

### Implemented files

```
be/src/modules/tours/prompts/tour-planning-policy.prompt.ts            (new — shared policy)
be/src/modules/tours/prompts/create-tour.prompt.ts                     (modified — 3 prompts recomposed)
be/src/modules/tours/prompts/create-tour.prompt.spec.ts                (modified)
be/src/modules/tours/utils/tour-density-policy.util.ts                 (new)
be/src/modules/tours/interfaces/tour-completeness.interface.ts         (new)
be/src/modules/tours/services/tour-completeness-validator.service.ts   (new)
be/src/modules/tours/services/tour-completeness-validator.service.spec.ts (new)
be/src/modules/tours/services/tour-activity-generation.service.ts      (modified — validator + bounded retry)
be/src/modules/tours/services/tour-activity-generation.service.spec.ts (modified)
be/src/modules/tours/interfaces/generation-trace.interface.ts          (modified — tour_completeness stage/fields)
be/src/modules/tours/utils/generation-trace-builder.util.ts            (modified — buildTourCompletenessStep)
be/src/modules/tours/utils/generation-trace-builder.util.spec.ts       (modified)
be/src/modules/tours/utils/activity-prompt-formatter.util.ts           (modified — duration unit fix)
be/src/modules/tours/services/tour-generation.service.ts               (modified — duration unit fix)
be/src/modules/tours/tours.module.ts                                   (modified — TourCompletenessValidator binding)
```

Known issue recorded, not fixed here:
`CoverageAnalyzer.requiredCandidateCount()` compares `explorationStyle`
against `'relaxed'`/`'fast_paced'`, which match neither the real
`ExplorationStyle` enum (`iconic|balanced|local_deep_dive`) nor
`TravelPace` — the 3/5-stops-per-day branches can never trigger in
practice, only the 4-stop default. Filed as a GitHub issue on the fork;
fixing it is PR 6/CoverageAnalyzer territory, not PR 7.2.

Not touched by this PR: PR 8 persistence, Activity Discovery/grounding
semantics, `CoverageAnalyzer`'s own logic, PR 10 transport feasibility, any
new `ActivityKind`.

---

## PR 8: Proposal entity resolution and safe persistence

**Status: Implemented, 2026-08-26.**

### Objective

Turn valid concepts into reusable Activities only after every required entity
is resolved, geographically disambiguated, and structurally validated.

### Resolution rules

- POIs, venues, museums, restaurants: Google Places.
- Streets, paths, routes, neighborhoods, boundaries: OSM/Nominatim/Overpass.
- Destination country/locality/boundary is required for disambiguation.
- External provider IDs and geometry are authoritative; embedding similarity is
  not identity proof.

### Required behavior

1. Add `ActivityProposalResolutionService` returning a typed
   `ResolvedActivityProposal` or structured rejection reasons.
2. Resolve each proposal's neighborhood AREA, not merely the parent city AREA.
   A San Telmo/Triana/Casco Antiguo family must belong to that real area.
3. Introduce the bounded exact OSM membership adapter and deterministic fixture
   here, with this resolver as its immediate consumer. Hydrate only the finite
   proposed boundaries and preserve unresolved/ambiguous/unavailable outcomes.
4. Keep candidates grouped by proposal and neighborhood. Do not flatten streets
   from multiple neighborhoods into one candidate bag that permits cross-area
   composites.
5. Validate:
   - expected provider type;
   - destination containment;
   - required hint resolution;
   - route geometry for ROUTE;
   - minimum viable waypoint count;
   - duration versus waypoint count/travel;
   - duplicate/repeated entities;
   - coherent area and theme.
6. Perform exact external-ID dedupe first, then semantic duplicate detection
   within the resolved destination as a review/reuse signal.
7. Persist accepted composites through `CompositeActivityService`:
   `AREA -> ActivityFamily -> variant Activity -> ActivityWaypoint`.
8. Reuse existing families/variants where identity matches. Waypoint content is
   mutable content, not variant identity.
9. Preserve `Restrict`, explicit merge/remove, archive-on-breakage, and
   `TourActivityWaypoint` snapshots.

### Tests and acceptance

- A Triana proposal cannot resolve to an identically named street in another
  city.
- A neighborhood walk cannot mix waypoints from Triana and Casco Antiguo unless
  it is explicitly a broader EXPERIENCE and passes transport validation.
- Unresolved required hints prevent persistence.
- An existing family/variant is reused.
- A bare OSM street is materialized as ROUTE or composite-only content, never
  POI.
- Historical tour snapshots remain unchanged after variant edits.

### Orchestration and PR 8/PR 9 boundary (clarified during implementation)

Neither this section nor PR 9's originally named a caller for
`ActivityProposalResolutionService` — the resolver, its OSM membership
adapter, and their 19 tests existed correctly but unwired for a full
session before this was noticed and closed. Confirmed the boundary from
PR 9's own required behavior #1 ("Re-query the catalog **after accepted
persistence**") — PR 9 assumes resolution+persistence already happened, so
invoking the resolver on real discovery proposals is this PR's job, not
PR 9's.

`TourActivityGenerationService` now calls `proposalResolver.resolve()`
immediately after a successful `discoverGaps()` call that returns at least
one proposal, passing the destination's OSM boundary when the destination
resolved to `scale: 'area'` (omitted for point-scale destinations, which
the resolver correctly rejects with `missing_destination_boundary` — no
new logic needed there, that's the resolver's existing, already-tested
behavior). Accepted proposals get persisted as real Activities exactly as
PR 8 specifies. A new `entity_resolution` bitácora step reports
accepted/rejected counts and per-rejection reasons — resolution failures
are non-fatal, mirroring how discovery's own failures never break
generation.

**Explicitly still not done (PR 9's job)**: a newly persisted Activity from
this mechanism is never added to the *current* generation's offered
candidate pool (`candidateActivityIds`/`candidateActivitiesById`) — it only
becomes selectable by a *future* generation's ordinary geographic catalog
query, once PR 9's re-query/ranking/windowing exists. Live-verified this
exact boundary: a tour that triggers discovery+resolution does not include
the newly resolved activity in its own itinerary, but a second generation
for the same destination (no code change, no re-discovery) picks it up as
a normal candidate.

**Operational consideration**: `ActivityProposalResolutionService`'s venue
resolution calls `placesApi.searchText` per venue-type entity hint — closing
this PR adds real Google Places calls to generations that reach discovery
(coverage insufficient + interests present + blocking deficit — already a
narrow, gated path, not every generation). No new feature flag was added to
gate this specifically; noted here for future cost/quota awareness rather
than solved now.

Implemented files: `tour-activity-generation.service.ts` (modified —
`PROPOSAL_RESOLVER` injection + orchestration), `tour-activity-generation.service.spec.ts`
(modified — 5 new tests), `generation-trace.interface.ts` (modified —
`'entity_resolution'` stage + `resolution` field), `generation-trace-builder.util.ts`
/ `.spec.ts` (modified — `buildEntityResolutionStep`). `activity-proposal-resolution.service.ts`,
`osm-membership.service.ts`, their specs, and the OSM fixtures were already
complete and are committed unchanged.

---

## PR 9: Unified candidate pool and generation integration

### Objective

Combine catalog, refill, and newly resolved discovery Activities into one
auditable pool without letting the itinerary model create entities.

### Required behavior

1. Re-query the catalog after accepted persistence and rebuild semantic and
   coverage reports.
2. Rank POIs and existing/new composites on a common scale:

   ```text
   semantic relevance
   + provider/catalog quality
   + curated confidence
   + requested kind/theme coverage
   + diversity
   - geographic dispersion penalty
   ```

3. Select a bounded candidate window with real Activity IDs only.
4. Include source, score components, and coverage contribution in the trace.
5. The itinerary LLM selects and schedules offered IDs; it does not create
   Activities or repair missing identities.
6. Preserve hard anti-hallucination verification for flat IDs, composite IDs,
   waypoint subsets, and duplicates.
7. If validation removes too many picks, reselect from the eligible pool or
   fail explicitly. Never invent replacements.

### Tests and acceptance

- Existing catalog variants are preferred over equivalent newly proposed ones.
- POIs do not automatically outrank composites because only POIs have ratings.
- Every selected stop traces to an offered Activity ID.
- A discovery provider outage leaves a valid catalog-only tour possible.
- An insufficient post-discovery pool fails before persistence.

---

## PR 10: Transport-aware spatial feasibility

### Objective

Select sets of Activities that form a feasible itinerary for the user's
allowed transportation modes, per-day and continuous walking limits, days,
pace, group, and time budget.

### Domain services

1. `MobilityProfileBuilder`
   - allowed modes: walking, cycling, driving, public_transport;
   - pace, daily time budget, maximum walking distance per day, and maximum
     continuous walking leg from the PR 4 contract;
   - group/accessibility constraints;
   - allowed mode changes and penalties.
2. `TravelTimeProvider`
   - provider-neutral pairwise time/distance request;
   - mode-aware results and explicit unavailable/degraded states;
   - Haversine only as a coarse prefilter, never final public-transit routing.
   - Overpass is an OSM data-query backend, not a routing implementation;
     an OSM-backed implementation requires a real engine such as OSRM,
     Valhalla, GraphHopper, or another reviewed adapter.
3. `SpatialFeasibilityAnalyzer`
   - builds a bounded pairwise matrix;
   - clusters viable candidates by day;
   - selects sets using relevance/coverage minus travel cost;
   - enforces maximum leg and daily travel budgets;
   - can split, reselect, or reduce stops.

### Mode-specific rules

- walking: pedestrian time, crossings/slopes/accessibility where available;
- cycling: cycle-suitable route and maximum riding time;
- driving: route plus parking/search overhead;
- public transport: estimated wait/transfers/access walk when the provider can
  supply them; otherwise a clearly conservative range.

### Integration rules

1. Run spatial feasibility after semantic eligibility and before final
   itinerary generation.
2. Feed feasible candidate groups per day to the LLM, not one unstructured
   city-wide list.
3. Add transport-feasible coverage to CoverageAnalyzer. Twenty semantic matches
   can still be insufficient if only three form a viable walking group.
4. Optimize order per day. Do not run one global route across multiple days.
5. Validate the returned schedule against the deterministic matrix before
   persistence.
6. Do not make K-Means with `K = requested days` an architecture contract. A
   candidate algorithm must account for travel-time cost, daily capacity,
   Activity duration, and hard constraints; it may return fewer natural areas
   than days and reuse one coherent area across multiple days.
7. Treat route construction as a scheduling problem, not pure TSP. The start
   location, opening hours, duration, daily time budget, and optional end
   location can make the shortest geometric order invalid.
8. Google Routes waypoint optimization may be used only for operation/mode
   combinations that the selected API contract supports. Google transit routes
   do not support intermediate waypoints; public-transport feasibility therefore
   uses supported pairwise legs/matrix data or an explicit conservative estimate
   plus the Maps handoff, not a fictional optimized multi-stop transit request.

### Tests and acceptance

- Walking-only Sevilla does not combine distant eastern suburbs with the
  historic center in one short day.
- A cycling/public-transport request may admit a broader set than walking.
- Multi-day tours produce coherent per-day geographic groups.
- The same walking-only candidates can be feasible for an “enjoys walking”
  profile and infeasible for “minimize walking”; neither limit is inferred from
  thematic walk preference.
- An infeasible LLM schedule is rejected and reselected/reduced.
- Provider failure is visible and uses a documented conservative fallback.

### Deferred follow-up: role-aware food and drink scheduling

Do not add a simple global cap on restaurants or cafes as part of the current
stabilization PRs. Food stops require a separate design that distinguishes
schedule-support stops in a general tour from primary stops in an explicitly
food-centric experience (for example, a tapas route). An interest list that
contains `food` alongside history, culture, or architecture is not sufficient
evidence that the whole tour is food-centric.

The follow-up must define food-stop roles, meal/time windows, separation and
repetition constraints, opening-hours and dietary checks, and how route
optimization preserves those constraints. Add the observed Granada case—three
consecutive cafe/coffee venues in a mixed tour—as a deterministic regression
fixture. Until then, do not implement an ad-hoc type-count rule that could also
break legitimate food tours.

---

## PR 11: MVP per-leg transport contract and Google Maps handoff

### Objective

Expose an actionable tour without implementing turn-by-turn navigation.

### Persisted MVP contract

Use the existing `TourActivity` transition convention and add:

```text
transportModeToNext
travelTimeToNext
distanceToNext
```

`transportModeToNext` is the mode selected for that actual leg, not merely one
of the modes the user allowed in the wizard.

### Required behavior

1. Add a Prisma enum/field and reviewed migration for the selected mode.
2. Persist time/distance from the deterministic travel provider or an explicit
   conservative approximation, never an unverified LLM claim.
3. Generate a Google Maps handoff using origin, destination, selected mode, and
   intended departure time when available.
4. For public transport, show for example:

   ```text
   Public transport - approximately 35 minutes
   Open current route in Google Maps
   ```

5. Do not persist bus/subway line, stop sequence, transfers, turn-by-turn
   directions, or detailed polyline in this MVP.
6. Defer a separate `TourLeg` model until multimodal sublegs, route geometry,
   provider metadata, or detailed snapshots are required.

### Likely files

- `be/prisma/schema.prisma` and migration
- tour DTOs/response types
- activity transformer and persistence flow
- frontend tour itinerary/map components
- Google Maps deep-link utility
- backend/frontend tests

### Tests and acceptance

- Every non-final same-day Activity has a selected mode and defensible estimate
  when routing is available.
- The final Activity of a day has no `toNext` leg.
- Public-transport links open Maps with the right endpoints and mode.
- A user allowing walking + transit can receive different modes per leg.
- Existing tours with null mode remain readable after migration.

---

## PR 12: End-to-end acceptance, rollout, and cleanup

### Objective

Prove the complete engine with deterministic fixtures, degraded-provider
scenarios, and real manual smoke tests before `codex/main -> main`.

### Deterministic regression scenarios

1. **Sevilla, cold catalog**
   - interests: history, art, food, culture, architecture;
   - family, low budget, walking + public transport;
   - bounded Places anchors provide geographic coverage without being called
     relevant; the hybrid profile recovers central must-see knowledge;
   - no empty-name candidate is persisted/offered;
   - known central cultural fixtures outrank unrelated suburban bars/parks;
   - no semantic-ranking claim when embeddings are unavailable;
   - provider degradation is visible.
2. **Barcelona, thin/off-topic catalog**
   - refill runs;
   - relevant Gothic/architecture candidates outrank hiking-only candidates;
   - a concrete grounded/reusable Gothic-area proposal is resolved and explored
     within its boundary; no global barrio crawl runs.
3. **Buenos Aires, multi-neighborhood**
   - sourced San Telmo/La Boca/etc. proposals resolve to real neighborhoods;
   - San Telmo/Triana-style variants bind to their neighborhood AREA, not the
     city AREA;
   - no candidate starvation from one dense neighborhood;
   - per-day groups avoid cross-city zigzags.
4. **Point-scale address/POI**
   - no city-wide exploration;
   - one bounded anchor;
   - current point-scale safety behavior remains intact.
5. **Montevideo, overqualified provider label and off-theme pool**
   - `Montevideo, Montevideo Department, Uruguay` resolves to the real city
     boundary through structured, coordinate-validated normalization;
   - fifteen real monuments do not count as coverage for missing art,
     architecture, and beach interests;
   - zero indexed candidates is reported as semantic ranking unavailable;
   - LLM statements about transit zones or opening hours are visibly
     unverified unless deterministic evidence exists.
6. **Córdoba, cold catalog and ambiguous OSM subdivisions**
   - destination-level Google seed uses explicit tourism-oriented Text Search;
   - Nearby coverage uses primary types and popularity independently from
     composite discovery;
   - administrative highway ways are not neighborhoods;
   - weak one-review/user-created fixtures are not admitted;
   - raw hundreds of neighborhoods are neither offered nor globally ranked;
   - a finite discovered area uses exact membership in proposal resolution,
     and provider failure rejects/degrades that proposal without guessing.
7. **Salta, misleading non-empty Nominatim results**
   - far-away POIs/buildings that merely contain the word `Salta` do not count
     as a coordinate-consistent destination match;
   - settlement-level reverse normalization resolves the selected coordinates
     to the real Salta city relation and enables area-scale exploration;
   - a selected address/POI still remains point-scale.
8. **Provider failures**
   - Places strict cache miss;
   - embedding provider unavailable/mismatched;
   - Overpass 429/timeout;
   - Wikidata missing QID and failed safety provider;
   - discovery provider unavailable;
   - travel-time provider unavailable.

### Quality assertions

Tests must assert candidate names, types, provenance, score/coverage decisions,
and final feasibility. Merely asserting that a method was called or a trace
stage exists is not sufficient.

### Rollout

1. Capability rollout controls may gate Activity Discovery and transport-aware
   selection, but they never route back to the removed global OSM composite
   generator. Every temporary rollout control has an owner and removal gate.
2. Deploy provider/cache/validation fixes before enabling discovery.
3. Rebuild embeddings with one declared model identity.
4. Run deterministic CI fixtures in strict cache mode.
5. Run bounded manual live-provider smoke tests and capture sanitized fixtures.
6. Compare old/new generation traces and quality metrics.
7. Enable discovery gradually, then spatial feasibility, then transport legs.
8. Delete rollout controls once the acceptance matrix passes; verify that the
   old selector, mocks, dependency wiring, and trace labels no longer exist.
9. Prepare the final `codex/main -> main` PR with:
   - architecture compliance checklist;
   - migration/rollback notes;
   - provider/cost limits;
   - known degraded modes;
   - acceptance results for every scenario above.

## Cross-cutting observability requirements

Every generation trace must make these facts reconstructable without reading
server logs:

- resolved destination and scale;
- actual Places/OSM/Wikidata/discovery/embedding/travel providers;
- cache hit/miss/strict behavior;
- anchors and neighborhoods explored;
- fetched, rejected, deduplicated, persisted, and embedded counts;
- semantic model identity and actual indexed coverage;
- provider failures and fallback/degraded decisions;
- CoverageAnalyzer deficits and decision;
- discovery proposals, evidence, resolution, and rejection reasons;
- score components for offered candidates;
- spatial groups, selected modes, travel budgets, and feasibility result;
- hallucinated/duplicate IDs removed;
- effective waypoint snapshots persisted.

LLM reasoning may be displayed for debugging, but it must be labeled as an
unverified model explanation. It cannot satisfy any trace requirement for
opening hours, transport mode, travel time, schedule, or route feasibility.

Do not put API keys, complete raw provider payloads, unsafe web text, or private
user data in the trace.

## Definition of done for the full plan

The plan is complete only when all of the following are true:

- catalog retrieval and quality-aware refill always precede discovery;
- a city is searched through representative bounded anchors, not one arbitrary
  bounding-box center;
- only validated provider entities enter the catalog;
- one embedding model/version is enforced and semantic degradation is truthful;
- CoverageAnalyzer measures themes, kinds, quality, provider health, and
  transport-feasible per-day groups;
- Activity Discovery is provider-neutral and cannot persist raw output;
- every persisted discovery entity resolves through Google Places or OSM;
- composite families bind to the correct real AREA and reuse Activities as
  waypoints;
- the itinerary LLM only selects verified IDs from feasible groups;
- anti-hallucination and historical waypoint snapshots remain intact;
- every persisted leg carries mode/time/distance when available;
- Google Maps owns live navigation details, while Zig-Zag owns itinerary
  feasibility;
- Sevilla, Barcelona, Buenos Aires, point-scale, and degraded-provider tests
  pass; and
- every implementation PR has its unit/regression tests, recorded multi-case
  local acceptance evidence, and explicit maintainer approval before merge;
- the final `codex/main -> main` PR contains no known silent degradation that
  can produce a grounded-but-obviously-bad tour.

## Deferred post-plan iteration: city-and-surroundings excursions

Regional excursions are important but are intentionally outside PRs 1–12 so
they do not weaken the urban containment and feasibility work currently being
stabilized. The feature must build on the finished intent, discovery,
entity-resolution, routing, and leg contracts instead of expanding the city
radius as an implicit fallback.

The later iteration must add:

- an explicit wizard scope such as `city_only` versus
  `city_and_surroundings`;
- a maximum acceptable excursion travel time and/or half-day/full-day
  preference, evaluated for the user's allowed transportation modes;
- catalog-first regional retrieval plus grounded discovery only for missing
  sourced excursion concepts;
- exact Places/OSM resolution and a regional containment/travel envelope that
  remains distinct from the authoritative city boundary;
- outbound, activity, and return-time feasibility inside the selected day;
- coherent excursion grouping so a remote attraction is not inserted as one
  unexplained outlier among urban stops; and
- truthful bitacora evidence for why an out-of-city Activity was eligible.

The deterministic acceptance case is **San Juan + Dique de Ullum**:

- `city_only` excludes the dique without calling that a provider failure;
- `city_and_surroundings` may include it only when exact resolution succeeds
  and the selected mode, outbound leg, visit duration, and return leg fit the
  user's declared excursion/day budget;
- semantic relevance to nature or outdoor interests can rank the resolved
  Activity but cannot override travel or scope constraints; and
- the reusable Activity is not duplicated merely to associate it with San
  Juan.
