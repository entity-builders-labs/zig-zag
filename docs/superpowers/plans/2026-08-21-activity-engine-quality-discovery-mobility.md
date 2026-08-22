# Activity Engine: Candidate Quality, Discovery, and Mobility Implementation Plan

> **Status:** Proposed implementation plan. No production code from this plan
> has been implemented yet.
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

1. queries and improves the existing catalog before discovery;
2. retrieves Activities that match the user's interests without losing hard
   geographic constraints;
3. refuses to treat a large but irrelevant pool as sufficient coverage;
4. discovers missing composite experiences through a replaceable,
   search-grounded provider;
5. resolves every proposed entity through Google Places or OSM before
   persistence;
6. selects Activities that form transport-feasible groups per day; and
7. returns per-leg mode, estimated time, and distance while delegating live
   navigation details to Google Maps.

This plan supersedes neither the completed destination-resolution plan nor its
commits. It begins from that implementation and addresses the next set of
problems exposed by a real local generation for Sevilla.

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
- Do not start Activity Discovery until catalog acquisition, validation,
  embeddings, and CoverageAnalyzer are reliable. Otherwise discovery will
  compensate for infrastructure failures and pollute the catalog.
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

## Mandatory delivery and local acceptance gate for every PR

No implementation PR in this plan may be merged into local `codex/main` merely
because it compiles or its happy path works. The following gate applies to PRs
1 through 11:

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

```text
PR 1  Provider identity, cache isolation, and truthful trace
  -> PR 2  Destination normalization, Wikidata, and Overpass reliability
  -> PR 3  Google Places multi-anchor refill and validation
  -> PR 4  Embedding integrity and hybrid catalog retrieval
  -> PR 5  CoverageAnalyzer and candidate quality gate
  -> PR 6  Provider-neutral Activity Discovery
  -> PR 7  Proposal entity resolution and safe persistence
  -> PR 8  Unified pool selection and generation integration
  -> PR 9  Transport-aware spatial feasibility
  -> PR 10 MVP per-leg transport contract and Maps handoff
  -> PR 11 End-to-end acceptance, rollout, and cleanup
```

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
4. Preserve the point-scale behavior for actual hotels, addresses, and POIs;
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

### Overpass changes

1. Stop issuing a full POI query for every raw neighborhood merely to compute
   shortlist scores.
2. Add a bounded shortlist-signal strategy, in priority order:
   - existing `ActivityFamily` coverage from PostgreSQL;
   - existing validated catalog POI coverage;
   - one batched/cached Overpass count request for cold neighborhoods, if a
     spike proves it reliable;
   - deterministic fallback that is explicit in the trace.
3. Query detailed streets/POIs only for shortlisted neighborhoods.
4. Add retry policy for 429/502/503/504 with bounded exponential backoff,
   jitter, `Retry-After` support, and a total request/time budget.
5. Default the shared public instance to conservative concurrency. The current
   limiter bounds in-flight calls but does not reduce the total queued burst or
   retry rate-limited calls.
6. Add a circuit breaker for the current generation: after the budget is
   exhausted, mark OSM degraded and continue with catalog candidates rather
   than enqueueing more calls.
7. Do not convert failed POI counts to trustworthy zero-density scores. Track
   `unknown` separately from `0`.
8. Preserve `map_to_area` containment and the relative
   `admin_level = city + 1` rule.

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
- `be/src/modules/tours/utils/neighborhood-shortlist.util.ts`
- matching specs

### Tests and acceptance

- The provider label `Montevideo, Montevideo Department, Uruguay` resolves to
  the real Montevideo city boundary when its structured locality/country and
  selected coordinates identify OSM relation `2929054`.
- A hotel/address selection remains point-scale after normalization.
- An ambiguous locality candidate inconsistent with the selected coordinates
  or country is rejected rather than accepted by result order.
- Literal JSON in the safety prompt formats successfully.
- Candidates without QIDs remain eligible.
- A 429 is retried within budget and recorded as degraded if exhausted.
- Unknown POI density does not outrank a known good neighborhood by accident.
- A Sevilla fixture cannot launch eleven simultaneous detailed POI searches.
- Casco Antiguo/Triana candidates remain available when another neighborhood
  fails.

---

## PR 3: Google Places multi-anchor refill and catalog validation

### Objective

Replace the single bounding-box-center crawl with bounded, representative
Google Places acquisition and validate results before catalog persistence.

### Anchor selection

1. Introduce a transient `DestinationAnchor` value object. It is not an
   Activity and is not persisted.
2. Point-scale destinations use their resolved/user point as one anchor.
3. Area-scale destinations derive 4-8 anchors from the shortlisted real
   neighborhoods. Prefer neighborhood geometry centroids and include the
   Nominatim destination point when it lies inside the authoritative boundary.
4. Do not use the city bounding-box center as the only Places origin.
5. Bound anchor count, category count, results per anchor, total latency, and
   total provider calls.

### Retrieval and validation

1. Search Google Places per anchor using categories relevant to missing catalog
   coverage, not an unbounded crawl of every category.
   - use Nearby Search as the normal operation for supported typed POIs;
   - use Google Text Search only for explicitly configured concepts that
     Nearby does not support well, never as an automatic quota bypass;
   - treat Geoapify `searchText` as a limited category-mapping compatibility
     operation, not as semantically equivalent free-text search;
   - never switch Google to Geoapify automatically after a provider failure;
   - allow independent configured operations to return partial results, while
     preserving the real degradation reason if no valid candidates remain.
2. Union and deduplicate results by provider + external ID before persistence.
3. Add `CatalogCandidateValidator` before `ActivitiesService.create`:
   - non-empty normalized name;
   - provider ID present;
   - finite coordinates;
   - inside the resolved destination boundary for area-scale;
   - not permanently closed;
   - supported/mappable type;
   - no obvious address-only or unnamed feature;
   - minimum confidence/quality policy appropriate to the provider.
4. Preserve rejection reasons in the trace. Do not silently count rejected
   rows as catalog coverage.
5. Persist only accepted real POIs and generate their canonical embeddings
   before the catalog is re-queried.
6. Keep provider provenance accurate on `Source` and `externalId`.
7. Do not create POIs from streets, paths, or neighborhood boundaries.

### Likely files

- new `be/src/modules/tours/services/destination-anchor.service.ts`
- new `be/src/modules/activities/services/catalog-candidate-validator.service.ts`
- `be/src/modules/integrations/google-places/google-places.service.ts`
- `be/src/modules/tours/services/tour-activity-generation.service.ts`
- geometry utilities for Point-in-Polygon/MultiPolygon containment
- trace builder and tests

### Tests and acceptance

- Sevilla uses anchors representing Casco Antiguo, Triana, and other shortlisted
  areas rather than one origin in Sevilla Este.
- An empty name is rejected and never persisted.
- Duplicate Places results from multiple anchors create one Activity.
- A high-rated result outside the city boundary is rejected.
- Point-scale behavior remains one point + bounded radius.
- The trace distinguishes fetched, accepted, deduplicated, rejected, and
  embedded counts.

---

## PR 4: Embedding integrity and hybrid catalog retrieval

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
- Before accepting PR 4, run one bounded live Bedrock smoke test from a local
  machine or isolated AWS development environment with explicit credentials.
  Use an isolated local index, clear it, and rebuild it entirely with Titan;
  do not mix it with Ollama vectors.
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

---

## PR 5: CoverageAnalyzer and candidate quality gate

### Objective

Replace `MIN_SUFFICIENT_ACTIVITIES = 15` as the definition of success with a
typed coverage report that decides whether refill, discovery, or explicit
failure is appropriate.

### Proposed contract

```ts
interface CoverageReport {
  status: 'sufficient' | 'insufficient' | 'degraded';
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
6. Run catalog refill first when conventional POI coverage is missing.
7. Run Activity Discovery only when the post-refill catalog still lacks
   quantities, themes, or composite kinds.
8. Never send an unusable candidate pool to the itinerary LLM merely because
   every ID is real.
9. Add a trace stage containing the report and exact decision.
10. Keep the first spatial signal lightweight (distribution/density). Full
    transport feasibility arrives in PR 9 and then becomes part of coverage.

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
- Refill occurs before discovery.
- Discovery receives only the reported deficits.
- With no usable candidates, generation fails explicitly before the LLM call.

---

## PR 6: Provider-neutral Activity Discovery

### Objective

Discover grounded experience concepts missing from the catalog without giving
the discovery model authority to create identities or coordinates.

### Domain contracts

```ts
type ProposalKind =
  | 'POI'
  | 'ROUTE'
  | 'AREA'
  | 'NEIGHBORHOOD_WALK'
  | 'EXPERIENCE';

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
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType: string;
}
```

### Required behavior

1. Introduce `SearchGroundedDiscoveryProvider` with a typed, provider-neutral
   request and response.
2. Implement one first grounded provider adapter behind configuration. Other
   adapters must not leak provider response shapes into the domain service.
3. `ActivityDiscoveryService` receives a `DestinationContext` and only the
   `CoverageDeficit[]` from CoverageAnalyzer.
4. Enforce schema validation, controlled enums, maximum proposal/hint counts,
   duration bounds, evidence presence, and prompt-injection-resistant handling
   of search content.
5. `ActivityDiscoveryService` has no Prisma dependency and never persists.
6. Raw provider output and evidence references go to the trace/audit record,
   not directly into catalog prose.
7. AREA remains primarily resolution context. Do not start broad POI discovery
   until validated Google refill proves insufficient.

### Likely files

- new discovery interfaces and DTO schemas
- new `activity-discovery.service.ts`
- new provider token/config and first adapter
- tour module wiring
- unit tests using provider-neutral fixtures

### Tests and acceptance

- A request missing architecture and food composites asks only for those gaps.
- Invalid kind, role, duration, or missing evidence rejects the proposal.
- Provider output containing coordinates/IDs does not become trusted identity.
- No Prisma create/update is reachable from discovery.
- Switching adapters does not change downstream proposal types.

---

## PR 7: Proposal entity resolution and safe persistence

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
3. Keep candidates grouped by proposal and neighborhood. Do not flatten streets
   from multiple neighborhoods into one candidate bag that permits cross-area
   composites.
4. Validate:
   - expected provider type;
   - destination containment;
   - required hint resolution;
   - route geometry for ROUTE;
   - minimum viable waypoint count;
   - duration versus waypoint count/travel;
   - duplicate/repeated entities;
   - coherent area and theme.
5. Perform exact external-ID dedupe first, then semantic duplicate detection
   within the resolved destination as a review/reuse signal.
6. Persist accepted composites through `CompositeActivityService`:
   `AREA -> ActivityFamily -> variant Activity -> ActivityWaypoint`.
7. Reuse existing families/variants where identity matches. Waypoint content is
   mutable content, not variant identity.
8. Preserve `Restrict`, explicit merge/remove, archive-on-breakage, and
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

---

## PR 8: Unified candidate pool and generation integration

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

## PR 9: Transport-aware spatial feasibility

### Objective

Select sets of Activities that form a feasible itinerary for the user's
allowed transportation modes, days, pace, group, and time budget.

### Domain services

1. `MobilityProfileBuilder`
   - allowed modes: walking, cycling, driving, public_transport;
   - pace and daily time budget;
   - group/accessibility constraints;
   - allowed mode changes and penalties.
2. `TravelTimeProvider`
   - provider-neutral pairwise time/distance request;
   - mode-aware results and explicit unavailable/degraded states;
   - Haversine only as a coarse prefilter, never final public-transit routing.
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

### Tests and acceptance

- Walking-only Sevilla does not combine distant eastern suburbs with the
  historic center in one short day.
- A cycling/public-transport request may admit a broader set than walking.
- Multi-day tours produce coherent per-day geographic groups.
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

## PR 10: MVP per-leg transport contract and Google Maps handoff

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

## PR 11: End-to-end acceptance, rollout, and cleanup

### Objective

Prove the complete engine with deterministic fixtures, degraded-provider
scenarios, and real manual smoke tests before `codex/main -> main`.

### Deterministic regression scenarios

1. **Sevilla, cold catalog**
   - interests: history, art, food, culture, architecture;
   - family, low budget, walking + public transport;
   - anchors include relevant central neighborhoods;
   - no empty-name candidate is persisted/offered;
   - known central cultural fixtures outrank unrelated suburban bars/parks;
   - no semantic-ranking claim when embeddings are unavailable;
   - provider degradation is visible.
2. **Barcelona, thin/off-topic catalog**
   - refill runs;
   - relevant Gothic/architecture candidates outrank hiking-only candidates;
   - neighborhood exploration remains bounded.
3. **Buenos Aires, multi-neighborhood**
   - real neighborhoods are shortlisted;
   - San Telmo/Triana-style variants bind to their neighborhood AREA, not the
     city AREA;
   - no candidate starvation from one dense neighborhood;
   - per-day groups avoid cross-city zigzags.
4. **Point-scale hotel/address**
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
6. **Provider failures**
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

1. Add feature flags for Activity Discovery and transport-aware selection.
2. Deploy provider/cache/validation fixes before enabling discovery.
3. Rebuild embeddings with one declared model identity.
4. Run deterministic CI fixtures in strict cache mode.
5. Run bounded manual live-provider smoke tests and capture sanitized fixtures.
6. Compare old/new generation traces and quality metrics.
7. Enable discovery gradually, then spatial feasibility, then transport legs.
8. Prepare the final `codex/main -> main` PR with:
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
