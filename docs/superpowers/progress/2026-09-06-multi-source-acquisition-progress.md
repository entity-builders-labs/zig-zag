# Multi-source Experience acquisition — progress

Canonical design: `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`

# Current State

- Branch: `feat/experience-domain-v2`
- Current milestone: Phase 6 — Tavily walk-query theme-awareness + `exploration_style` facet (VERIFIED)
- Verified Phase 6 code commits: `2d023e110119bff4fb42fbe675865d6b38c041a3` (Tavily theme-aware),
  `37ad22873d1045a61a8144962205975f6c360a75` (`exploration_style` → ranking facet)
- Previous Phase 5 hardening code commit: `f24f6f4efff270f3a08d4616f1628b619c7f1302`
- Previous Phase 5 code commit: `54eceebbec90a1662f32b44385364d091b3be55e`
- Previous Phase 4 final-verification code commit: `28c550936bdfec853fea3fe9353efc11cc30bdb5`
- Previous Phase 4 hardening code commit: `0321576b4f335a26039943ec3668a7390ce05139`
- Previous Phase 4 initial code commit: `a42aa3f453973f09491a3ab5603cc9146763286a`
- Previous Phase 3 code commit: `8415df6d2e6fdd32ee4a04a3d729f3d5ea93dc24`
- Last verified test state: backend Jest `119/119` suites and `928/928` tests passing
  (+8 in Phase 6, zero regressions vs the prior 920).
- Targeted Phase 6 suites: `8/8` suites, `92/92` tests passing
  (`tavily-grounded-search.service.spec.ts`, `preference-facet-vocabulary.spec.ts`,
  `preference-facet-merge.util.spec.ts`, `preference-facet-matching.util.spec.ts`,
  `experience-preference-evaluator.util.spec.ts`, `preference-interpreter.service.spec.ts`,
  `hard-soft-preference-contract.spec.ts`, `experience-acquisition-planner.service.spec.ts`).
- Linting: `yarn lint:check` is 100% clean (0 errors, 0 warnings across `{src,apps,libs,test}/**/*.ts`).
- Build: `yarn build` (`nest build`) is 100% clean.
- `yarn run check` (typecheck + lint:check): still fails **only** on the same 7 pre-existing baseline
  `tsc` errors under `be/test/acceptance/**` and `test/acceptance/unit/completeness-validator.spec.ts`
  (`PlanningExperienceCandidate.startFootprint/endFootprint`, `TourCompletenessIssue.dayNumber` —
  PR10 daily-planning drift, unrelated to acquisition). **check baseline errors: 7 · final errors: 7 ·
  new errors from Phase 6: 0.** `src/**` typechecks clean.
- **OSM proactive acquisition is implemented and verified through
  `ExperienceAcquisitionService.executePlan`, but live tour-generation orchestration remains
  intentionally deferred to Phase 7.**

# Completed

### Phase 1: Wikivoyage Structured Acquisition Adapter
- **Shared Provider-Neutral Acquisition Contracts**:
  Created `be/src/modules/tours/interfaces/experience-acquisition.interface.ts` defining:
  - `ExperienceAcquisitionProvider` (`'wikivoyage' | 'osm' | 'google_places' | 'web'`)
  - `SourceEvidenceType` (`'tourism_activity' | 'place' | 'route' | 'area' | 'operator' | 'editorial'`)
  - `SourceObservationGeo`
  - `SourceObservation`
  - `AcquisitionProviderResult<T>`
- **Wikivoyage API Boundary & Types**:
  Created `be/src/modules/tours/interfaces/wikivoyage-api.interface.ts` defining MediaWiki response models, internal section enums (`SEE`, `DO`, `EAT`, `OTHER`), and `WikivoyageEntry`.
- **Wikivoyage API Service & Balanced Parser**:
  Created `be/src/modules/tours/services/wikivoyage-api.service.ts`:
  - Balanced brace extractor preventing premature termination on nested templates and links.
  - Recognizes characterized listing templates (`see`, `do`, `eat`, `listing`, `listado`, `ver`, `hacer`, `comer`).
  - Robust parameter parsing (`name`/`nombre`, `content`/`description`/`descripción`/`contenido`, `lat`/`latitude`, `long`/`lon`/`longitude`, `wikidata`).
  - Sibling failure isolation (malformed entries skipped individually without failing valid siblings).
  - Explicit error discrimination: `missingtitle` -> `not_found`, HTTP/network/parse error -> `failed`.
- **Fixtures and Comprehensive Tests**:
  - Saved 7 fixtures under `be/test/fixtures/wikivoyage/`: `san-telmo.json`, `la-boca.json`, `recoleta.json`, `palermo.json`, `missing-article.json`, `mediawiki-error.json`, `malformed-entry.json`.
  - Unit tests in `be/src/modules/tours/services/wikivoyage-api.service.spec.ts` (12 tests) verifying fixture parsing, coordinate parsing, QID extraction, sibling fault isolation, and mocked HTTP transport failures (HTTP 500, timeouts, malformed payloads).
- **Wikivoyage Acquisition Provider**:
  Created `be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts`:
  - Narrow `acquire(destination, options?)` signature.
  - Maps `WikivoyageEntry` into a provider-neutral `SourceObservation`. The
    initial `wikivoyage:${articleSlug}:${entrySlug}` evidenceKey noted here was
    **superseded** in Phase 3 — see "Wikivoyage Evidence Key Hardening" and
    "Evidence Identity vs Entity Identity" below. Current code
    (`wikivoyage-acquisition.provider.ts`) emits the collision-resistant
    listing key `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`
    unconditionally, and the normalized Wikidata QID lives in `externalId`
    (never in `evidenceKey`).
  - Returns `{ status: 'success', value: [] }` on missing article.
  - Unit tests in `be/src/modules/tours/providers/wikivoyage-acquisition.provider.spec.ts` (4 tests).
- **Conservative Mechanical Candidate Synthesizer**:
  Created `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.ts`:
  - Strictly mechanical mapping:
    - `place` -> `role: 'venue'`, `expectedKind: 'PLACE'`
    - `area` -> `role: 'area'`, `expectedKind: 'AREA'`
    - `route` -> `role: 'route'`, `expectedKind: 'ROUTE'`
    - `tourism_activity`, `operator`, `editorial` -> `componentHints: []`
  - Zero semantic inference: `themes: []`, `traits: []`, `intents: []`, `orderedByEvidence: false`.
  - Unit tests in `be/src/modules/tours/services/structured-experience-candidate-synthesizer.service.spec.ts` (5 tests).
- **NestJS Module Wiring**:
  Registered and exported `WikivoyageApiService`, `WikivoyageAcquisitionProvider`, and `StructuredExperienceCandidateSynthesizerService` in `be/src/modules/tours/tours.module.ts`. Downstream orchestration untouched.
- **Live Wikivoyage Characterization**:
  Characterized San Telmo, La Boca, Buenos Aires/Recoleta, and Palermo (Buenos Aires) with live metrics:
  - San Telmo: 9 entries (7 place, 2 tourism_activity); coords 4/9 (44%), QID 4/9 (44%); latency 229ms.
  - La Boca: 4 entries (3 place, 1 tourism_activity); coords 0/4 (0%), QID 4/4 (100%); latency 210ms.
  - Buenos Aires/Recoleta: 9 entries (8 place, 1 tourism_activity); coords 3/9 (33%), QID 5/9 (56%); latency 235ms.
  - Palermo (Buenos Aires): 13 entries (12 place, 1 tourism_activity); coords 5/13 (38%), QID 5/13 (38%); latency 370ms.
- **Phase 1 Hardening (Coordinate Validation & Strict Numeric Parsing)**:
  - Hardened `WikivoyageApiService` coordinate parsing to reject partially numeric inputs (e.g. `"12abc"`, `"-34.61foo"`) using strict regex `/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/` and finite number check.
  - Added geographic boundary checks: latitude within `[-90, 90]` and longitude within `[-180, 180]`.
  - Added 5 dedicated unit tests in `be/src/modules/tours/services/wikivoyage-api.service.spec.ts` covering valid coordinates, non-numeric strings, partially numeric strings, out-of-range latitude, and out-of-range longitude.

### Phase 2: Preference Facets & Deterministic Importance Mapping
- **Preference Facet Domain Model**:
  Created `be/src/modules/tours/preferences/preference-facet.interface.ts`:
  - Defined `PreferenceFacetSource` (`'wizard' | 'free_text'`) and `PreferenceFacetStrength` (`'strong' | 'medium' | 'weak'`).
  - Defined canonical `PreferenceFacet` (`dimension`, `key`, `importance`, `confidence`, `source`) and `InterpretedPreferenceFacet`.
  - Implemented deterministic weight calculations: `calculateEffectiveWeight(facet)` (`importance * confidence`) and deterministic strength mapping: `mapStrengthToImportance(strength)` (`strong -> 1.0`, `medium -> 0.7`, `weak -> 0.5`).
- **Controlled Multi-Dimensional Vocabulary & Canonical Mapping**:
  Created `be/src/modules/tours/preferences/preference-facet-vocabulary.ts`:
  - Declared `PREFERENCE_DIMENSIONS` covering `theme`, `trait`, `intent`, `winery_scale`, `tourism_intensity`, `nature_type`, `local_character` (and `exploration_style` reserved as dormant).
  - Seeded `INITIAL_DIMENSION_VOCABULARY` aligning directly with repository reality (`INTEREST_ACQUISITION_CATEGORIES`, trait definitions, and wizard intents).
  - Implemented `canonicalizeFacetKey(dimension, rawKey)` to deterministically map synonyms and localized expressions (e.g. Spanish `arquitectura` -> `architecture`, `caminata` -> `walk`, `comida` -> `food`, `vegetariano` -> `vegetarian`) into canonical keys.
- **Unified Normalized Intent Contract**:
  Updated `be/src/modules/tours/interfaces/preference-interpretation.interface.ts`:
  - Replaced legacy string arrays with a single canonical positive collection: `preferredFacets: PreferenceFacet[]`.
  - Preserved existing negative and constraint fields (`excludedThemes`, `excludedTraits`, `hardExclusions`, `softConstraints`, `ambiguities`, `dietaryPreferences`, `accessibilityPreferences`, `budgetPreferences`, `groupPreferences`, `positiveSemanticQuery`, `notes`).
  - Exported deterministic helpers `getFacetsByDimension(facets, dimension)` and `getFacetKeysByDimension(facets, dimension)`.
- **Wizard Normalization & Strict Wizard Precedence**:
  Created `be/src/modules/tours/utils/preference-facet-merge.util.ts`:
  - `normalizeWizardFacet(dimension, rawKey)`: always sets `importance: 1.0, confidence: 1.0, source: 'wizard'`.
  - `mergePreferenceFacets(wizardFacets, interpretedFacets)`: enforces compound `${dimension}:${key}` deduplication where wizard facets strictly override free-text facets without altering wizard confidence or importance, while preserving disjoint free-text facets.
  - Comprehensive unit test suite in `be/src/modules/tours/utils/preference-facet-merge.util.spec.ts` (9 tests passing).
- **Preference Interpreter Service Facet Integration**:
  Updated `be/src/modules/tours/services/preference-interpreter.service.ts`:
  - LLM prompt & schema updated to emit `preferredFacets` with `{ dimension, key, confidence, strength }`.
  - Enforced `canonicalizeFacetKey` and `mapStrengthToImportance` in `normalizeFacets`.
  - Dormant `exploration_style` dimension explicitly ignored in Phase 2.
  - Deterministic regex `fallback()` upgraded to construct candidate facets and route through identical normalization.
  - Unit tests updated and passing in `be/src/modules/tours/services/preference-interpreter.service.spec.ts`.
- **Experience Preference Evaluator Equivalence & Explainability**:
  Updated `be/src/modules/tours/utils/experience-preference-evaluator.util.ts`:
  - Evaluates `preferredFacets` via `effectiveWeight = importance * confidence`.
  - Evaluates legacy positive constraint terms (`dietary`, `accessibility`, `budget`, `group`) with fixed weight `1.0` to preserve mathematical equivalence.
  - Clamped score: `clamp01(positiveRatio - negativePenalty * 0.45 - exclusionPenalty * 0.8)`.
  - Added `facetMatches: PreferenceFacetMatch[]` to `PreferenceEvaluation` recording each genuine facet's `dimension`, `key`, `importance`, `confidence`, `effectiveWeight`, `source`, and `matched` boolean (strictly containing real facets, never synthetic constraint records).
  - Regression unit tests in `be/src/modules/tours/utils/experience-preference-evaluator.util.spec.ts` proving exact mathematical equivalence with 1.0 weights, explainability transparency, and weight differentiation.
- **Downstream Pipeline Migration**:
  - Updated `be/src/modules/tours/utils/hard-soft-preference-contract.spec.ts` for `preferredFacets`.
  - Updated `be/src/modules/tours/services/experience-generation.service.ts`:
    - `emptyNormalizedPreferences()` initializes `preferredFacets: []`.
    - `mergeStructuredPreferences()` normalizes wizard interests & intents into wizard facets and merges with interpreted facets.
    - `buildCoverageReport`, `rankAndSliceExperiences`, `selectBoundedWindow`, and candidate discovery extraction updated to use `getFacetKeysByDimension`.
    - `GenerationTrace` / candidate pool step captures `preferenceEvaluation` with `facetMatches` and `scoreBreakdown` intact.
- **Phase 2 Hardening (Dimension-Aware Matching & Controlled Vocabulary Enforcement)**:
  - **Pure Dimension-Aware Matcher**:
    Created `be/src/modules/tours/utils/preference-facet-matching.util.ts`:
    - Strict dimension isolation:
      - `theme`: matches only against `experience.themes` and `metadata.themes`.
      - `intent`: matches only against `experience.intents`, `metadata.intents`, and `metadata.archetypes`.
      - `trait`: matches against `experience.traits`, `metadata.traits`, and `dimensionedTraits` where `dimension === 'trait' || dimension === 'general'`.
      - Structured dimensions (`winery_scale`, `tourism_intensity`, `nature_type`, `local_character`): matches only against explicit dimension-specific evidence (`dimensionedTraits`, `metadata.dimensionedTraits`, `metadata.preferenceFacets`, `metadata.facets`, `metadata.dimensions`). False positive matches against name/description/generic traits completely eliminated.
      - Dormant `exploration_style` and unknown dimensions return `false`.
    - Unit test suite: `be/src/modules/tours/utils/preference-facet-matching.util.spec.ts` (14 unit tests covering all dimensions, false-positive prevention, and edge cases).
  - **Vocabulary & Dimension-Scoped Synonyms**:
    Updated `be/src/modules/tours/preferences/preference-facet-vocabulary.ts`:
    - Audited repository reality and added missing valid intents (`food`, `nightlife`) and themes (`shopping`, `sports`).
    - Replaced global flat synonyms with dimension-scoped `DIMENSION_KEY_SYNONYMS: Record<PreferenceDimension, Record<string, string>>`.
    - Updated `canonicalizeFacetKey(dimension, rawKey)` to strictly enforce vocabulary for controlled dimensions, returning `undefined` for invalid/dormant/unknown keys.
    - Unit test suite: `be/src/modules/tours/preferences/preference-facet-vocabulary.spec.ts` (10 unit tests).
  - **Runtime Hydration of `dimensionedTraits`**:
    - Updated `ExperienceCatalogService` (`findVerifiedWithin()` and `findById()`) to map and preserve `dimensionedTraits: Array<{ dimension: string; key: string; label?: string }>` on hydrated experiences and metadata while keeping backward-compatible `traits: string[]`.
    - Updated `ExperienceGenerationService` (`hydratePersistedExperience()`) to map `dimensionedTraits` from trait definitions and metadata.
    - Unit tests in `experience-catalog.service.spec.ts` verifying preservation of `dimensionedTraits`.
  - **Preference Evaluator Dimension Isolation**:
    Updated `be/src/modules/tours/utils/experience-preference-evaluator.util.ts`:
    - Replaced corpus-wide text matching with `candidateMatchesPreferenceFacet(experience, facet)`.
    - Unit tests in `experience-preference-evaluator.util.spec.ts` verifying false-positive immunity on `winery_scale` and valid dimensioned matches.
  - **Interpreter & Merge Discipline**:
    - Updated `normalizeWizardFacet()` in `preference-facet-merge.util.ts` to return `PreferenceFacet | undefined`, rejecting invalid keys and dormant `exploration_style`.
    - Updated `mergePreferenceFacets()` to filter out invalid or undefined facets.
    - Updated `experience-generation.service.ts` to filter out undefined wizard facets.
    - Updated `preference-interpreter.service.ts` to reject invalid keys in controlled dimensions.
    - Updated `preference-interpreter.service.spec.ts` and `preference-facet-merge.util.spec.ts` (11 unit tests).
  - **Final Hardening Checkpoint (Verified in `f12b2d56dada8a6db7bfc2e2308ea45366426955`)**:
    - **Malformed/Missing LLM Facet Dimension Handling**:
      - Updated `PreferenceInterpreterService.normalizeFacets()` to drop facets with missing or blank dimensions instead of defaulting to `'theme'`.
      - Maintained clean rejection for unknown dimensions via `canonicalizeFacetKey` and dormant `exploration_style`.
      - Added explicit unit tests in `preference-interpreter.service.spec.ts` verifying that `{ key: "history", confidence: 0.9, strength: "strong" }` and `{ dimension: "", key: "history", confidence: 0.9, strength: "strong" }` are dropped.
    - **E2E Acceptance Fixture Validation**:
      - Updated `normalizedIntent` in `be/test/experience-selection-scale.e2e-spec.ts` to strictly throw on unnormalizable overrides for `preferredThemes`, `preferredTraits`, and `preferredIntents`, removing the fallback facet fabrication bypass.
      - Explicitly migrated custom-facet scenarios (`mixed-age-family` with `interactive`, `long-tail` with `hidden history`, and `CP8` with `religion`) to declare explicit `preferredFacets: [...]`.
  - **E2E Scale Helper & Architecture Documentation**:
    - Updated `be/test/experience-selection-scale.e2e-spec.ts` legacy fixture helper to use wizard semantics (`source: 'wizard'`, `importance: 1.0`, `confidence: 1.0`).
    - Updated `CLAUDE.md` to document `preferredFacets: PreferenceFacet[]`, dimension isolation, and scoring invariants.

### Phase 3: Deterministic Corroboration + Acquisition Planning Foundation
- **Provider Union Restoration**:
  - Restored `'wikidata'` to `ExperienceAcquisitionProvider` in `be/src/modules/tours/interfaces/experience-acquisition.interface.ts` (without creating a standalone Wikidata provider).
- **Wikivoyage Evidence Key Hardening**:
  - Updated `WikivoyageAcquisitionProvider.acquire()` to emit a single
    collision-resistant listing `evidenceKey`,
    `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`,
    with deterministic duplicate-occurrence tracking per normalized key.
    (An earlier draft folded a `wikivoyage:${articleSlug}:wikidata:${qid}`
    variant into the key; that was dropped — the normalized QID goes to
    `externalId`, see "Wikivoyage Evidence Identity Decoupling" below.)
  - Added unit test in `wikivoyage-acquisition.provider.spec.ts` for duplicate listing names in the same article.
- **Shared Real-World Matching Primitives**:
  - Created `be/src/modules/tours/utils/real-world-entity-matching.util.ts`:
    - `REAL_WORLD_RECONCILIATION_RADIUS_METERS = 150`
    - `normalizeRealWorldName(value)`
    - `realWorldNamesMatch(left, right)`
    - `distanceMeters(left, right)`
  - Unit tests in `real-world-entity-matching.util.spec.ts` (9 tests passing).
  - Refactored `ExperienceCatalogService` to use these shared primitives while preserving exact reconciliation behavior (30/30 tests passing).
- **Structured Candidate Proposal Envelope**:
  - Created `be/src/modules/tours/interfaces/structured-candidate-proposal.interface.ts` defining `StructuredCandidateProposal { candidate: ExperienceCandidate; observations: SourceObservation[]; }`.
  - Updated `StructuredExperienceCandidateSynthesizerService`: added `synthesizeProposals()` and delegated `synthesize()` to it.
- **Wikivoyage Evidence Identity Decoupling**:
  - `evidenceKey` strictly identifies the source-listing observation: `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`.
  - Normalized Wikidata QID resides strictly in `externalId` (used for entity-level matching and corroboration).
  - Distinct listings pointing to the same QID (e.g. Mercado San Telmo SEE vs Tour gastronómico Mercado San Telmo DO) receive distinct listing-specific `evidenceKeys`.
  - Comprehensive unit tests in `wikivoyage-acquisition.provider.spec.ts` (6 tests passing).
- **Pairwise Corroboration Engine & Conservative Grouping**:
  - Created `be/src/modules/tours/services/structured-candidate-corroboration.service.ts`:
    - `decidePair(left, right)`: Rule A (exact evidenceKey match), observation structural compatibility check, Rule B (canonical Wikidata QID match), real-world geographic proximity (< 150m) & normalized name matching. Decisions: `SAME`, `NEW`, `AMBIGUOUS`.
    - Conservative complete-link clustering: input sorted deterministically; a proposal joins a cluster only if it is SAME with all existing cluster members; if a candidate could join multiple clusters, it is kept separate; `AMBIGUOUS` pairs never merged.
    - Single-place component hint collapse: merging two single-place proposals yields exactly 1 `GeoEntityHint` on the resulting candidate only when `role` and `expectedKind` are compatible; conflicting kinds are never collapsed and pairwise decisions classify them as `AMBIGUOUS` (`conflicting_component_expected_kind`).
    - Merged candidate synthesis: unioned sorted `evidenceKeys`, `themes`, `traits`, `intents`; longest normalized name and description.
    - Traces: structured `CorroborationMergeResult` with `candidates`, `groups`, and `pairDecisions`.
  - Comprehensive unit test suite in `structured-candidate-corroboration.service.spec.ts` (13 tests passing, covering Scenarios A through M: exact duplicates, Wikidata QID, 10m cross-provider places, 5km far places, 20m distinct places, name match without coords, place vs route, tourism activity vs place, component hint collapse, transitive conflict, input order independence, Scenario L regression on conflicting expectedKind, and Scenario M regression verifying that sharing a Wikidata QID across distinct observation kinds like place vs tourism_activity never merges them).
- **Dimension-Aware Acquisition Deficit & Routing Foundation**:
  - Created `be/src/modules/tours/interfaces/experience-acquisition-plan.interface.ts` defining canonical `ExperienceAcquisitionPlan` (`destination: ExperienceDiscoveryScope`, `breadth: ExperienceDiscoveryBreadth`, `deficits: AcquisitionDeficit[]`, `sourcePlans: SourcePlan[]`), where `SourcePlan` is a discriminated provider plan containing only its own provider payload (`wikivoyage`, `osm`, `places` under `google_places`, and `web`).
  - Created `be/src/modules/tours/constants/acquisition-source-routing.ts` defining explicit hand-maintained capability routing table mapping strictly canonical Phase 2 `(dimension, key)` to provider capabilities, purging non-canonical dimensions (`cuisine`, `setting`, `category`, `vibe`), adding all required canonical routes (`theme:wine`, `winery_scale:boutique`, `nature_type:park`, `local_character:authentic`, `intent:walk`, etc.), leaving `exploration_style` strictly dormant, and providing conservative generic deficit fallback (Wikivoyage + Web only, no OSM or Places broad pollution).
  - Created `be/src/modules/tours/services/experience-acquisition-planner.service.ts`:
    - `projectCoverageDeficits(legacyDeficits)`: projects legacy `CoverageDeficit` items without regex string parsing.
    - `projectPreferenceFacetDeficits(candidates, preferredFacets)`: evaluates candidate pool using pure matcher `candidateMatchesPreferenceFacet`, emitting deficits for unmet facets.
    - `buildAcquisitionPlan(input)`: multi-deficit coalescing across Wikivoyage (canonical `SEE`, `DO`, `EAT`), OSM (sorted concepts), and Google Places (sorted search types).
    - Unroutable / dormant deficit handling: if all deficits are unroutable (e.g. `exploration_style`), planner returns `sourcePlans: []` without manufacturing a web query.
    - Single web query guarantee: at most ONE plain-keyword web query per acquisition pass (`<destination> <sorted keywords> <semanticQuery>`), with zero LLM query builder or prompt prose.
    - `exploration_style` strictly dormant (never emits deficits or source plans).
    - Unknown dimension fallback: routes ONLY to web with sanitized keyword.
    - Generic dimensionless deficit fallback: routes to conservative Wikivoyage broad + web only.
  - Comprehensive unit test suite in `experience-acquisition-planner.service.spec.ts` (14 tests passing, covering Scenarios M through T, explicit dormant deficits, generic fallback, and specific canonical dimension routing tests).
- **NestJS Module Registration**:
  - Registered and exported `StructuredCandidateCorroborationService` and `ExperienceAcquisitionPlannerService` in `be/src/modules/tours/tours.module.ts`. Downstream orchestration and resolver remain completely untouched.

### Phase 4: Google Places Cutover into the Acquisition Framework (FINAL HARDENING VERIFIED)
- **Verified Code Commit**:
  - `0321576b4f335a26039943ec3668a7390ce05139` (final hardening)
  - `a42aa3f453973f09491a3ab5603cc9146763286a` (initial cutover)
- **GooglePlacesAcquisitionProvider Implementation**:
  - Created `be/src/modules/tours/providers/google-places-acquisition.provider.ts`:
    - Injects `PlacesApiService` and implements standard `AcquisitionProviderResult<SourceObservation>` contract.
    - Supports coordinate search (`searchNearby`) and text fallback (`searchText`).
    - Hardened text fallback: when coordinates are absent, single `searchTypes` strictly enforces `includedType` and `strictTypeFiltering: true`. Multiple `searchTypes` deterministically issues per-type `searchText` queries and dedupes places by `place.id` while preserving `maxResultCount`. Unconstrained destination-only text search is prevented when types are specified.
    - Emits provider-neutral `SourceObservation` with `provider: 'google_places'`, `evidenceKey: 'google_places:' + place.id`, `evidenceType: 'place'`, `metadata`.
    - Non-inference invariant: does not infer tourism_activity, route, area, themes, traits, intents, or preference facets.
    - Coordinate validation: finite numbers, lat in [-90, 90], lon in [-180, 180]. Invalid coordinates safely rejected.
    - Conservative admissibility check: rejects generic/commercial categories (`point_of_interest`, `establishment`, `store`, `lodging`, `bank`, `gas_station`, etc.) unless allowed tourism types (`museum`, `park`, `tourist_attraction`, `winery`, etc.) are present.
    - Provider failure isolation: catches API throws and returns `{ status: 'failed', value: [], failureReason }` without bubbling uncaught exceptions.
    - Unit tests in `be/src/modules/tours/providers/google-places-acquisition.provider.spec.ts` (10 tests passing).
- **Cross-Source Corroboration**:
  - Verified `StructuredExperienceCandidateSynthesizerService` handles `google_places` observations provider-neutrally.
  - Added Google Places cross-source corroboration test suite in `be/src/modules/tours/services/structured-candidate-corroboration.service.spec.ts` (17 tests total passing):
    - Wikivoyage + Google Places $\le 150$m with matching name merges into 1 `ExperienceCandidate` with unioned evidenceKeys and 1 collapsed `GeoEntityHint`.
    - Distance > 150m with same name remains 2 distinct candidates (`NEW`).
    - Overlapping coordinates $\le 150$m with different names marked `AMBIGUOUS` and not merged.
    - Google Places `place_id` does NOT auto-merge via QID rule with Wikivoyage Wikidata QID.
- **Complete Elimination of Catalog-Level Persistence Shortcut**:
  - Refactored `ExperienceCatalogService.acquireNearbyAsExperiences` in `be/src/modules/tours/services/experience-catalog.service.ts`:
    - Completely removed the direct local loop calling `this.upsertGeoEntity` and `this.persistVerifiedExperience`.
    - `acquireNearbyAsExperiences` is strictly non-persistent and returns `{ experienceIds: [], experiences: [], candidates, observations, provenance }`.
    - Added dedicated test in `be/src/modules/tours/services/experience-catalog.service.spec.ts` asserting that `upsertGeoEntity` and `persistVerifiedExperience` are never called from `acquireNearbyAsExperiences`.
    - Verified opening hours normalization and persistence via direct catalog persistence test in `experience-catalog-opening-hours.spec.ts` (2 tests passing).
- **Single Resolver-Backed Persistence Path**:
  - Wired `ExperienceProposalResolver` into `ExperienceAcquisitionService`:
    - `executePlan` populates deterministic `evidence` records (`ResolverEvidenceItem[]`) directly from `SourceObservation` fields.
    - `acquireNearby` accepts destination context (`destinationName`, `destinationCountryCode`, `destinationBoundary`, `destinationPointRadius`).
    - When destination context is present, routes candidates through `proposalResolver.resolve(...)`, passing matching evidence records. Only candidates accepted by the resolver and geographic validation are materialized in the catalog.
    - Candidates rejected by geographic validation (e.g. `GEOGRAPHIC_VALIDATION_FAILED`) are never written to the catalog.
    - Updated `ExperienceGenerationService` refill call site to pass resolved destination boundary and point-radius context to `acquireNearby`.
    - Added `materializeExecution(execution, context)` helper for explicit plan materialization.
    - Added unit tests in `be/src/modules/tours/services/experience-acquisition.service.spec.ts` verifying resolver delegation, evidence propagation, and geographic rejection preservation (11 tests passing).
- **NestJS Module Registration**:
  - Registered and exported `GooglePlacesAcquisitionProvider` in `be/src/modules/tours/tours.module.ts`.

### Phase 4: Final Verification (`28c550936bdfec853fea3fe9353efc11cc30bdb5`)
Five acquisition-layer robustness fixes; the resolver-backed materialization
architecture (Places → `SourceObservation[]` → `StructuredCandidateProposal[]`
→ corroboration → `ExperienceCandidate[]` → `ExperienceProposalResolverService
.resolve()` → `CompositeGeographicValidationService` → dedupe → persistence)
is unchanged.

- **Generic-commercial Places admission rule ("Starbucks problem")**:
  - `google-places-acquisition.provider.ts`: `DEFAULT_ALLOWED_GOOGLE_PLACES_TYPES`
    split into `SAFE_GENERIC_TOURISM_TYPES` (tourist_attraction, museum, art_gallery,
    park, national_park, historical_landmark, historical_place, church,
    place_of_worship, zoo, aquarium, amusement_park, observation_deck,
    visitor_center, cultural_center, campground, winery) and
    `CONTEXTUAL_GOOGLE_PLACES_TYPES` (restaurant, cafe, bakery, bar, night_club).
    `DEFAULT_ALLOWED_GOOGLE_PLACES_TYPES` retained as the derived union.
  - `isAdmissible`: with no explicit `searchTypes` the allowlist is
    `SAFE_GENERIC_TOURISM_TYPES` only — a contextual commercial type is admissible
    **only** when the acquisition plan/`searchTypes` explicitly requested it. The
    `onlyDisallowed` guard still rejects broad-generic-only results
    (`point_of_interest`/`establishment`/store/bank/pharmacy/…). Rule is purely
    type-driven; no brand names.
  - Semantic invariant preserved: Google Places `type` never infers
    `theme/trait/intent/winery_scale/nature_type/local_character/tourism_intensity`
    or a quality facet, even for an explicitly requested contextual type — the
    `SourceObservation` carries only factual `metadata`
    (rating, userRatingCount, primaryType, types, openingHoursWeekdayText).
  - Regression tests in `google-places-acquisition.provider.spec.ts`: generic refill
    rejects a Starbucks-like cafe; an explicit `searchTypes: ['cafe']` may admit it;
    generic museum/park/tourist_attraction still admitted; pharmacy/bank/store still
    rejected; no semantic facet inference with an explicit contextual type.

- **Provider failure vs successful-empty distinction**:
  - `ExperienceCatalogService.acquireNearbyAsExperiences` now inspects
    `providerResult.status`. `status: 'failed'` throws a structured
    `PlacesCrawlError` (truthful `PlacesCrawlProvenance` — `receivedCount: 0`,
    `acceptedCount: 0` — and `code: 'request_failed'`) instead of returning a
    successful empty acquisition. `status: 'success', value: []` still returns a
    normal empty acquisition (`experienceIds: []`, `receivedCount: 0`, no error).
  - Propagation is via the existing seam: `ExperienceAcquisitionService.acquireNearby`
    does not catch it, so it reaches `ExperienceGenerationService`'s existing
    `PlacesCrawlError` refill `catch` (`experience-generation.service.ts` ~1432-1475),
    which records the failed `places_crawl` bitácora step, degrades coverage
    (`{ status: 'degraded', reason: code }`), and continues on the existing
    catalog/discovery/Wikivoyage pool. Not a global fatal error unless the
    existing coverage rules independently fail the tour.
  - Regression tests in `experience-catalog.service.spec.ts`: failed provider
    rejects with `PlacesCrawlError` (and never reaches synthesis/corroboration);
    successful `[]` stays a normal empty acquisition.
  - `ExperienceGenerationService` has no unit spec harness; standing one up for a
    ~1500-line service is disproportionate here, and item 20 was explicitly
    conditional. The isolation/observability seam is already in code and the throw
    is unit-covered at the catalog boundary.

- **Truthful embedding provenance**:
  - `ExperienceAcquisitionService.acquireNearby` resolver-backed branch no longer
    sets `embeddedCount: acceptedIds.length` / `embeddingWriteStatus: 'indexed'` /
    `embeddingFailureReason` / `embeddingIdentity`. Embedding indexing is owned by
    `ExperienceProposalResolverService.resolve()` (gated on dedupe `NEW` /
    `semanticDocumentChanged`, and the embedding provider may be `unavailable`);
    its per-Experience outcome is not propagated, so those optional
    `PlacesCrawlProvenance` fields are omitted rather than invented. Both return
    branches now type their provenance as `PlacesCrawlProvenance` explicitly.
  - Regression test in `experience-acquisition.service.spec.ts`: an accepted
    resolver candidate yields `embeddingWriteStatus === undefined` and
    `embeddedCount === undefined` (fails if `embeddedCount: acceptedIds.length` or
    `'indexed'` is reintroduced).

- **`destinationBoundary` guard**:
  - `canResolve` is now `Boolean(this.proposalResolver) && Boolean(input.destinationBoundary)`
    — `destinationPointRadius` alone (supplemental point-scale context) can no
    longer enter `ExperienceProposalResolverService.resolve()`, which throws
    `'Experience resolution requires destinationBoundary'` without a boundary.
    Point-scale destinations still resolve: `ExperienceGenerationService` passes a
    synthetic point-radius `destinationBoundary` alongside the real
    `destinationPointRadius`.
  - Regression tests in `experience-acquisition.service.spec.ts`: pointRadius-only
    → resolver not called, acquisition stays non-persistent; boundary + pointRadius
    together → resolver called with both.

- **Exact accepted-ID retrieval**:
  - New `ExperienceCatalogService.findVerifiedByIds(ids: string[])` — order-preserving,
    exact-id (`where: { id: { in: ids }, status: VERIFIED }`), returns exactly the
    requested rows (a missing/non-VERIFIED row simply drops out), no geographic
    scan/filter. The resolver-backed `acquireNearby` now uses it instead of
    `findVerifiedWithin(lat,lng,radius,max)`, so the returned `experiences`
    correspond exactly to the accepted resolver `experienceIds` and never leak an
    unrelated nearby Experience.
  - Per-row hydration extracted into a shared private `projectVerifiedExperienceRow`
    helper reused by `findVerifiedWithin` and `findVerifiedByIds`; `findVerifiedWithin`
    behavior (radius filter, distance, `distanceSquared` sort + id tie-break, slice)
    is byte-for-byte preserved (its existing spec stays green).
  - Regression tests: `findVerifiedByIds` returns only the requested rows and
    short-circuits on an empty id list; acquisition spec asserts
    `findVerifiedByIds` is called with exactly the accepted ids and
    `findVerifiedWithin` is not.

- **Untouched (verified intact)**: resolver / `CompositeGeographicValidationService`
  / SAME-NEW-AMBIGUOUS dedupe / synthesizer / `ExperienceAcquisitionPlannerService`
  / cross-provider corroboration (all corroboration specs green) / Google text
  fallback `searchTypes` behavior (1 type → strict `includedType`; N types →
  per-type dedup by `place.id`, respects `maxResultCount`). No schema/migration,
  no OSM/Tavily/`exploration_style` work, no `ExperienceCandidate` shape change,
  no module-wiring change. (Phase 5 — OSM proactive acquisition — is the subsection below.)

### Phase 5: OSM proactive acquisition (`54eceebbec90a1662f32b44385364d091b3be55e`)
OSM becomes a proactive, deficit-driven acquisition source (not only a reactive
component-hint resolver), integrated into `ExperienceAcquisitionService.executePlan`
alongside Wikivoyage and Google Places. Everything downstream (synthesis,
corroboration, resolver, geographic validation, dedupe) is shared and unchanged.

- **New structured Overpass operation**:
  - `IOverpassApiService.queryFeaturesNear({ latitude, longitude, radiusMeters, selectors })`
    (`be/src/modules/integrations/osm/interfaces/overpass.interface.ts`, with a structured
    `OverpassSelector` = `{ key, value?, elementTypes?, requireName? }`).
  - `overpass-query.util.buildFeaturesNearQuery` emits **one** bounded `around:` union query,
    `out tags center` (not `out geom`), one line per selector; strict-subset `elementTypes`
    expand to one line per element type (no `nwr` shorthand). `sanitizeOverpassTagToken`
    (`/^[A-Za-z0-9_:]+$/`, else throws) hard-validates every tag key/value token — a concept
    can never inject raw QL. Defensive builder radius cap 8000 m; throws on an empty selector list.
  - Implemented on `OverpassApiService` (reuses `execute()` — retries / per-attempt timeout /
    concurrency / total budget / `User-Agent` / `OVERPASS_API_URL`) and on
    `CachedOverpassApiService` (same `read` / `write` / `strict` file cache, keyed by
    method + params).
  - `OsmPlacesService.lookupFeaturesNear(lat, lng, radius, selectors)` wraps it: caps the
    radius to `maxFeaturesRadiusMeters` (`OVERPASS_MAX_FEATURES_RADIUS_METERS`, default 8000),
    maps elements through the existing `toCandidate` (drops nameless), and NEVER throws —
    `{ status: 'failed', value: [], failureReason }` on any Overpass error, same defensive
    contract as its siblings. `.env.example` documents the new var.

- **Explicit concept → selector registry** (`be/src/modules/tours/constants/osm-acquisition-concepts.ts`):
  - Hand-maintained `OSM_ACQUISITION_CONCEPTS` maps each acquisition-plan concept
    (`SourcePlan.osm.concepts`, from `acquisition-source-routing.ts`) to safe Overpass
    selectors + a domain `evidenceType`. Concepts covered: `museum`, `gallery`, `arts_centre`,
    `restaurant`, `cafe`, `bar`, `pub`, `nightclub`, `monument`, `historic`, `viewpoint`,
    `peak`, `volcano`, `beach`, `winery`, `vineyard`, `park`, `nature_reserve`, `forest`,
    `wood`, `hiking`, `footway`.
  - `OSM_UNSUPPORTED_CONCEPTS` (`building`, `tourism`, `route`, `scenic`, `waterway`,
    `coastline`, `river`, `desert`) is dropped from the OSM plan — never turned into a
    whole-radius `nwr["building"]`-style query. Unknown concepts are treated as unsupported.
  - `resolveOsmConcepts(concepts)` dedupes+sorts, splits supported/unsupported, and flattens
    the supported selectors into one list for the single union query.
  - A registry test asserts: every selector token passes `sanitizeOverpassTagToken`; every
    `evidenceType ∈ {place, area, route}`; every routing-table `osmConcept` is either mapped
    or explicitly unsupported (nothing in limbo).

- **`OsmAcquisitionProvider`** (`be/src/modules/tours/providers/osm-acquisition.provider.ts`):
  - Depends only on `OsmPlacesService` — **strictly non-persistent** (never touches Prisma /
    `upsertGeoEntity` / `persistVerifiedExperience`).
  - Resolves concepts → runs **one** `lookupFeaturesNear` → maps each `OsmCandidate` to a
    provider-neutral `SourceObservation`: `provider: 'osm'`,
    `externalId === evidenceKey === osm:${elementType}:${elementId}`, `title` from the `name`
    tag, `geo` a centroid of the returned geometry, `metadata` = `{ osmType, osmTags,
    matchedConcepts }` (sorted+deduped, **trace only**).
  - The same OSM element matched by several concepts ⇒ **one** observation (matchedConcepts
    unioned).
  - `evidenceType` from **selector semantics, never element type**: `route` if any matched
    concept is route-like; else `area` only when a matched concept is area-like AND the element
    is a way/relation (a bare `node` downgrades to `place`); else `place`.
  - **No semantic inference** — matched concepts never become
    `themes/traits/intents/winery_scale/tourism_intensity/local_character/nature_type/exploration_style`.
  - States: Overpass failure → `{ status: 'failed', value: [], failureReason }` (isolated to OSM);
    no coordinates or all-unsupported concepts or empty Overpass response →
    `{ status: 'success', value: [] }`, and Overpass is not called in the first two cases.
    (`NO_OSM_MATCH` is deliberately **not** used here — it belongs to the reactive resolver.)

- **`executePlan` integration** (`be/src/modules/tours/services/experience-acquisition.service.ts`):
  - New `@Optional()` `osmProvider` ctor param (appended last — existing positional test
    constructions unaffected). New `sourcePlan.provider === 'osm'` branch, mirror of the
    Wikivoyage / Google Places branches: own try/catch, `providerResults.osm` recorded,
    observations pushed into the shared `allObservations` → `synthesizeProposals` →
    `corroborateAndMerge`. An OSM failure degrades only OSM; Wikivoyage / Places still contribute.
  - `OsmAcquisitionProvider` registered + exported in `be/src/modules/tours/tours.module.ts`
    (injects `OsmPlacesService`, already re-exported via `IntegrationsModule`).

- **NOT wired into live tour generation**: `experience-generation.service.ts` is untouched;
  `buildAcquisitionPlan` / `executePlan` remain dormant infrastructure. **OSM proactive
  acquisition is implemented and verified through `ExperienceAcquisitionService.executePlan`,
  but live tour-generation orchestration remains intentionally deferred to Phase 7.**

- **Live characterization** (real `overpass-api.de`): San Telmo (−34.6208, −58.3717), r = 1500 m,
  union of `historic=monument` / `tourism=viewpoint` / `leisure=park` → HTTP 200, ~10 s latency,
  83 elements, all named (5 node / 70 way / 8 relation); tag breakdown `leisure=park` ×77,
  `historic=monument` ×6, plus a few `tourism=attraction`. Confirms the structured union query,
  the `["name"]` filter, and `out tags center` all work against the real endpoint.

- **Tests**: +37 across 2 new suites (`osm-acquisition-concepts.spec.ts`,
  `osm-acquisition.provider.spec.ts`) and updates to `overpass-query.util.spec.ts`,
  `overpass-api.service.spec.ts`, `cached-overpass-api.service.spec.ts`,
  `osm-places.service.spec.ts`, `experience-acquisition.service.spec.ts` (`executePlan` OSM
  branch + OSM↔Places corroboration), `structured-candidate-corroboration.service.spec.ts`
  (OSM cross-source scenarios).

### Phase 5: Hardening (`f24f6f4efff270f3a08d4616f1628b619c7f1302`)
One narrow hardening pass before closure — no architecture change, no live tour-generation
wiring, no Phase 6/7 work. Previous Phase 5 code: `54eceeb…`.

- **Deterministic output order** — `OsmAcquisitionProvider.acquire` sorts the final
  `SourceObservation[]` by `evidenceKey` ascending (`localeCompare`) after dedupe. Reversing
  the Overpass response order — or the requested-concept order (already normalized by
  `resolveOsmConcepts` → `uniqueSorted`) — now yields a deep-equal, identically-ordered
  result. `matchedConcepts` stays `uniqueSorted` on both first-emit and merge.
- **Defensive OSM identity validation** — `OsmPlacesService.toCandidate()` now rejects an
  element whose `type` is not `node`/`way`/`relation` **or** whose `id` is not a finite
  positive integer, *before* building `osm:${type}:${id}`. A malformed sibling is skipped
  (`return null`); the lookup never throws, never fails, and identity is never synthesised
  from name/coordinates. Applies to every OSM lookup path (centralised at the one
  `OverpassElement → OsmCandidate` seam). Canonical identity unchanged:
  `externalId === evidenceKey === osm:${type}:${id}`.
- **Defensive geo validation** — `centroidOfGeometry()` only emits `geo` when latitude and
  longitude are finite and within `[-90,90]` / `[-180,180]`; otherwise `geo: undefined`
  (no clamping, no invented point). The observation's identity/title still survive an
  absent `geo`.
- **Food / nightlife not proactively acquired** — `restaurant`, `cafe`, `bar`, `pub`,
  `nightclub` moved from `OSM_ACQUISITION_CONCEPTS` into `OSM_UNSUPPORTED_CONCEPTS`. A
  generic food/nightlife venue is an operational itinerary stop, not a gastronomic
  Experience in itself; curated Wikivoyage / web / Places evidence — never a bare OSM
  `amenity` tag, no rating/`tourism=yes` heuristic, no LLM classification — must establish
  that a food venue *is* a tourism Experience. Requesting only these concepts ⇒ Overpass not
  called ⇒ `{ status: 'success', value: [] }`. `acquisition-source-routing.ts` untouched
  (the routing table may still name them; the capability registry says "unsupported for
  proactive Experience acquisition"). The registry invariant ("every routed `osmConcept` is
  explicitly supported or explicitly unsupported") still holds.
- **Winery semantics** — the `winery` selector is now `craft=winery` only. `shop=wine`
  (a vinoteca / wine shop) is no longer treated as a winery Experience.
- **Structured provider provenance** — `AcquisitionProviderResult<T>` gains an optional,
  provider-neutral `provenance?: Record<string, unknown>` (Wikivoyage/Places don't set it;
  nothing added to `SourceObservation`). `OsmAcquisitionProvider` attaches it on **every**
  return (success / empty-early-return / failed):
  `requestedConcepts` (normalized: trimmed, non-empty, deduped, sorted) ·
  `supportedConcepts` (with a registry entry) · `unsupportedConcepts` (explicit + unknown) ·
  `radiusRequestedMeters` · `rawResultCount` (raw `OverpassElement` count before adapter
  filtering) · `candidateCount` (`OsmCandidate[]` after `toCandidate`: drops
  nameless / invalid-identity / null-geometry) · `observationCount` (final list) ·
  `dedupedCount` (candidates whose `osm:${type}:${id}` was already emitted this pass —
  the same real element returned more than once by the union query; counted explicitly, NOT
  `candidateCount − observationCount`, which would also include zero-concept-match drops) ·
  `evidenceKeys` (final sorted list). No raw payloads, no secrets, no preference semantics.
- **Raw result count through the lookup** — `OsmPlacesService.lookupFeaturesNear` now returns
  a narrow `OsmFeatureLookupResult extends OsmLookupResult<OsmCandidate[]> { rawResultCount }`
  (shared `OsmLookupResult` untouched). `rawResultCount = elements.length` on success,
  `0` on failure and on the empty-selectors early return. `success []` vs `failed []`
  semantics unchanged.
- **Provenance survives `executePlan`** — `providerResults.osm = res` already carries the
  provider result verbatim, so `provenance` flows through unchanged; tests assert it on both
  the success and failure paths, and that a sibling provider still contributes when OSM fails.
- **Untouched**: `experience-generation.service.ts`, `buildAcquisitionPlan`/`executePlan`
  wiring, `ExperienceCandidate` shape, synthesizer, corroboration, resolver, geographic
  validation, dedupe, catalog persistence, ranking, planner, tour materialization, Tavily,
  `exploration_style`, preference interpretation, `acquisition-source-routing.ts`. No
  `OsmCandidate → Experience` persistence, no OSM-specific synthesizer, no OSM quality
  scoring. (Phase 6 — the OSM hardening pass did not touch it — is the subsection below.)
- **Tests**: +16 (deterministic order ×2, geo validation ×6, malformed-identity ×2 in
  `osm-places.service.spec.ts`, `rawResultCount` cases, food/nightlife-unsupported ×5,
  `shop=wine`≠winery, structured-provenance fields, provenance-survives-`executePlan`).

### Phase 6: Tavily theme-awareness + `exploration_style` facet (`2d023e1`, `37ad228`)
Two independent web/exploration fixes; no acquisition-orchestration change, no live
tour-generation wiring, no Phase 7 work.

- **Tavily walk/route query is theme-aware** (`tavily-grounded-search.service.ts`,
  commit `2d023e1`): `buildWalkQuery` now folds the first two `request.requestedThemes`
  into the phrase — `10 caminatas históricas y arquitectónicas icónicas en {destino}` /
  `10 iconic history and architecture walking routes in {destino}` — one query per
  request (no theme explosion), both language branches, the `icónicas`/`iconic`
  disambiguator kept. No themes → the exact legacy phrase unchanged. A small local
  canonical-key → Spanish-adjective table; an unmapped key falls through as-is.
  `isWalkOrRouteRequest` / walk↔route_like bucketing unchanged (route_like not made
  distinct). No interface / schema / other-provider change.
- **`exploration_style` activated as a ranking facet** (commit `37ad228`):
  - Vocabulary: `INITIAL_DIMENSION_VOCABULARY['exploration_style']` fixed to the real
    `ExplorationStyle` enum poles `['iconic', 'local_deep_dive']` (the Phase-2
    speculative `relaxed/balanced/intensive` keys were wrong — that pace axis is
    `TravelPace`). `BALANCED` is deliberately absent → no facet, no ranking pressure.
    `canonicalizeFacetKey`'s dormant early-return removed; `iconic`/`local_deep_dive`
    canonicalize, everything else (`balanced`, `relaxed`, unknown) → `undefined`.
  - Wizard merge point (`experience-generation.service.ts` `mergeStructuredPreferences`):
    `normalizeWizardFacet('exploration_style', request.intent.explorationStyle)` is added
    to the wizard facets (`source:'wizard'`, importance/confidence 1.0); `BALANCED` →
    `undefined`, dropped. Single point where the structured field reaches
    `NormalizedPreferenceIntent`.
  - Matching (`preference-facet-matching.util.ts`): an `exploration_style` branch matched
    against the **same explicit dimensioned evidence** a candidate already carries —
    `iconic` → `tourism_intensity: iconic | popular`; `local_deep_dive` →
    `tourism_intensity: hidden | local` **or** `local_character: authentic`. Only
    `dimensionedTraits` / `metadata.preferenceFacets` / `metadata.facets` /
    `metadata.dimensions` — **never** name / description / duration / component count.
    Soft ranking, never an exclusion. The 3×-inlined dimensioned-evidence reader is
    extracted into a shared `hasExplicitDimensionedEvidence` helper (behaviour-preserving
    for the existing structured dimensions).
  - **Unchanged guards** (verified, kept dormant): the LLM interpreter still cannot emit
    `exploration_style` (prompt + drop-guard in `preference-interpreter.service.ts`);
    `experience-acquisition-planner.service.ts` and `acquisition-source-routing.ts` still
    ignore it, so it never triggers acquisition, never shrinks the pool, and never shapes
    a search query. No schema change.
- **Tests**: +8 across the two commits (Tavily themed phrase ES/EN + route_like + no-themes
  fallback + unmapped-key survives + two-theme cap; `exploration_style` canonicalization
  `iconic`/`local_deep_dive`/`balanced`; wizard-facet normalization + merge; matcher
  positive/negative + cross-dimension isolation + no name/description/duration inference;
  evaluator participation).
- **Not touched**: `experience-generation.service.ts` acquisition orchestration,
  `buildAcquisitionPlan`/`executePlan` wiring, `semantic-tour-query-builder.util.ts`,
  `prompt-builder.util.ts` (deprecated `/tours/nearby`), `CoverageAnalyzer`'s dead
  `explorationStyle?` param, Gemini/Groq/SerpApi providers, `ExperienceCandidate` shape,
  schema, resolver/validation/dedupe/solver/planner, `feat/agentic-travel-planning`.
  **Phase 7 not started.**

# In Progress

None. Phase 6 (Tavily theme-awareness + `exploration_style` facet) is verified and CLOSED.

# Not Started

- Phase 7: Final acquisition orchestration — wire `buildAcquisitionPlan` / `executePlan`
  (catalog → coverage deficits → acquisition plan → structured/web providers → corroboration →
  resolver → refill/requery → ranking → planner → materialization) into
  `experience-generation.service.ts` for live tours. **OSM proactive acquisition is ready for
  this step but not yet consumed by a real tour.**

Cross-cutting target architecture and branch convergence (future `Activities` and `Events`
source families, `Search Retrieval` vs `Grounded Research` as a capability split,
convergence with `feat/agentic-travel-planning` after an Integration Gate, and
`Operational Requirements` / `Operational Stops`) are documented in
`docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`,
`docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`, and
`docs/superpowers/plans/2026-09-09-agentic-acquisition-integration-handoff.md`. Those documents
do **not** change the status of Phase 5 / 6 / 7 above — Phases 6 and 7 remain not started, and
must not be expanded to absorb that future work.

# Verification

Phase 6 verified against code commits `2d023e110119bff4fb42fbe675865d6b38c041a3` (Tavily
theme-aware) and `37ad22873d1045a61a8144962205975f6c360a75` (`exploration_style` facet):

- `yarn test --runInBand` (`be/`): PASS — **119** suites, **928** tests passing
  (+8 over the prior 920, zero regressions).
- Targeted Phase 6 suites: PASS — **92/92** across 8 suites
  (`tavily-grounded-search.service.spec.ts`, `preference-facet-vocabulary.spec.ts`,
  `preference-facet-merge.util.spec.ts`, `preference-facet-matching.util.spec.ts`,
  `experience-preference-evaluator.util.spec.ts`, `preference-interpreter.service.spec.ts`
  (LLM drop-guard intact), `hard-soft-preference-contract.spec.ts`,
  `experience-acquisition-planner.service.spec.ts` (planner still ignores `exploration_style`)).
- `yarn lint:check` (`be/`): PASS — 0 errors, 0 warnings.
- `yarn build` (`be/`): PASS — `nest build` completes cleanly.
- `yarn run check` (`be/`): FAIL — exclusively on the same 7 pre-existing baseline `tsc` errors
  under `be/test/acceptance/**` + `test/acceptance/unit/completeness-validator.spec.ts` (PR10
  drift, unrelated). **check baseline errors: 7 · final errors: 7 · new errors from Phase 6: 0.**
  `src/**` typechecks clean.

### Phase 5 hardening verification — code commit `f24f6f4efff270f3a08d4616f1628b619c7f1302`

- `yarn test --runInBand` (`be/`): PASS — **119** suites, **920** tests passing
  (+16 over the prior 904, zero regressions).
- Targeted OSM/acquisition suites: PASS — **146/146** tests across 8 suites
  (`overpass-query.util.spec.ts`, `overpass-api.service.spec.ts`, `cached-overpass-api.service.spec.ts`,
  `osm-places.service.spec.ts`, `osm-acquisition-concepts.spec.ts`, `osm-acquisition.provider.spec.ts`,
  `experience-acquisition.service.spec.ts`, `structured-candidate-corroboration.service.spec.ts`).
- Phase 4 no-regression suites: PASS — **80/80** across 4 suites
  (`google-places-acquisition.provider.spec.ts`, `experience-catalog.service.spec.ts`,
  `experience-acquisition.service.spec.ts`, `structured-candidate-corroboration.service.spec.ts`) —
  no Starbucks-cafe pollution, no direct persistence, no provider-failure flattening, no fabricated
  embedding provenance, no broad nearby exact-ID bug.
- `yarn lint:check` (`be/`): PASS — 0 errors, 0 warnings.
- `yarn build` (`be/`): PASS — `nest build` completes cleanly.
- `yarn run check` (`be/`): FAIL — exclusively on the same 7 pre-existing baseline `tsc` errors
  under `be/test/acceptance/**` + `test/acceptance/unit/completeness-validator.spec.ts` (PR10 drift,
  unrelated). **check baseline errors: 7 · final errors: 7 · new errors from this hardening: 0.**
  `src/**` typechecks clean.

### Phase 5 (initial) verification — code commit `54eceebbec90a1662f32b44385364d091b3be55e`

- `yarn test --runInBand` (`be/`): PASS — 119 suites, 904 tests (+37 / +2 suites over 867, zero regressions).
- Targeted Phase 5 suites: PASS — 130/130 across 8 suites.
- `yarn lint:check` / `yarn build` (`be/`): PASS.
- Live characterization: real `overpass-api.de` `queryFeaturesNear` for San Telmo returned a
  well-formed, named-only result set (see the Phase 5 "Live characterization" note above).

---

## Historical: Phase 4 verification

Verified against code commit `28c550936bdfec853fea3fe9353efc11cc30bdb5`:

- `yarn test --runInBand` (`be/`): PASS — 117 suites, 867 tests passing (+12 over the prior 855, zero regressions).
- Targeted Phase 4 suites: PASS — 74/74 tests across 5 suites
  (`google-places-acquisition.provider.spec.ts` (15), `experience-catalog.service.spec.ts` (26),
  `experience-acquisition.service.spec.ts` (14), `structured-candidate-corroboration.service.spec.ts` (17),
  `experience-catalog-opening-hours.spec.ts` (2)).
- `yarn lint:check` (`be/`): PASS — 0 errors, 0 warnings across `{src,apps,libs,test}/**/*.ts`.
- `yarn build` (`be/`): PASS — `nest build` completes cleanly.
- `yarn run check` (`be/`): FAIL — but exclusively on 7 pre-existing baseline `tsc` errors under
  `be/test/acceptance/**` + `test/acceptance/unit/completeness-validator.spec.ts`, byte-identical to
  the `7003c369` baseline (PR10 `PlanningExperienceCandidate` / `TourCompletenessIssue` drift,
  unrelated to acquisition). This finalization adds zero new `tsc` errors; `src/**` typechecks clean.

# Important Decisions / Invariants

- **Single Persistence Path for Acquired Experiences**:
  - `ExperienceProposalResolverService.resolve()` -> geographic validation (`CompositeGeographicValidationService`) -> `ExperienceCatalogService.persistVerifiedExperience()` is the ONLY path for persisting acquired experiences into the catalog.
  - `GooglePlacesAcquisitionProvider` and `acquireNearbyAsExperiences` never write directly to the database.
- **Provider-Neutral SourceObservation Boundary**:
  - Google Places outputs `SourceObservation` with `provider: 'google_places'`, `evidenceKey: 'google_places:' + place.id`, and `evidenceType: 'place'`.
  - Raw Google Places results never bypass observation / proposal / corroboration.
- **Strict Google Places Text Fallback Filtering**:
  - When coordinates are absent and text search is used, `searchTypes` are strictly enforced with `includedType` and `strictTypeFiltering: true`.
  - For multiple types, deterministic per-type searches deduplicate places by `place.id` while preserving `maxResultCount`. Unconstrained destination-only text search is prohibited when types are specified.
- **Conservative Google Places Admissibility**:
  - Purely commercial/generic types (`point_of_interest`, `establishment`, `store`, `lodging`, `bank`, etc.) are rejected unless allowed tourism types (`museum`, `park`, `tourist_attraction`, `winery`, etc.) are present.
- **Evidence Identity vs Entity Identity**:
  - `evidenceKey` is strictly listing-specific and collision-resistant: `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}` or `google_places:${placeId}`.
  - Normalized Wikidata QID identifies real-world entities and is stored in `externalId`.
  - Google Places IDs never collide or merge via Wikidata QID matching.
- **Corroboration Decisions**:
  - Allowed decisions: `SAME`, `NEW`, `AMBIGUOUS`.
  - `AMBIGUOUS` is NEVER force-merged into `SAME` or `NEW`.
  - Real-world entity reconciliation radius: 150 meters.
  - Conservative complete-link clustering prevents false merges under transitive conflicts.
  - Single-place component hint collapse: merging two single-place proposals yields exactly 1 `GeoEntityHint` on the resulting candidate only when `role` and `expectedKind` match.
  - Activity-like observations (`tourism_activity`, `route`, `operator`, `editorial`) are never merged with places even if they share coordinates or Wikidata QID.
- **OSM proactive acquisition (Phase 5, hardened)**:
  - OSM concepts are turned into Overpass queries ONLY via the explicit
    `OSM_ACQUISITION_CONCEPTS` registry — never by interpolating a concept string into QL.
    Every tag token is re-validated by `sanitizeOverpassTagToken`.
  - Broad concepts (`building`, `tourism`, `route`, `scenic`, `waterway`, `coastline`, `river`,
    `desert`) AND generic food/nightlife venues (`restaurant`, `cafe`, `bar`, `pub`,
    `nightclub`) are explicitly unsupported for proactive OSM Experience acquisition — recall
    is deliberately sacrificed rather than emitting a whole-radius or "a nearby restaurant
    exists" query. A food venue is proven to be a tourism Experience by Wikivoyage / web /
    Places, not a bare OSM `amenity` tag. `winery` = `craft=winery` only (never `shop=wine`).
  - One bounded Overpass union query per `SourcePlan.osm` (`out tags center`, `["name"]`, radius
    capped), reusing `OverpassApiService.execute` + `CachedOverpassApiService` + `OVERPASS_API_URL`.
  - `OsmAcquisitionProvider` is non-persistent and mechanical: `evidenceType` from selector
    semantics (not OSM element type; `area` needs a way/relation, a node downgrades to `place`);
    `matchedConcepts` is trace metadata only, never inferred into themes/traits/intents/facets.
  - **Deterministic output**: final observations are sorted by `evidenceKey`; identical
    semantic elements yield a deep-equal result regardless of Overpass or concept order.
  - **Defensive boundaries**: `toCandidate()` rejects a malformed OSM identity (bad `type`,
    non-finite/non-positive `id`) — skip the sibling, never throw; `centroidOfGeometry()`
    emits `geo` only when finite and in valid degree ranges, else `undefined` (no clamping).
  - OSM identity is `osm:${elementType}:${elementId}` for both `externalId` and `evidenceKey`;
    it never merges with a Wikidata QID identity. An OSM provider failure degrades only OSM,
    and `success []` stays distinct from `failed []`.
  - **Structured provenance** on every `OsmAcquisitionProvider` return
    (`AcquisitionProviderResult.provenance`, provider-neutral optional): `requestedConcepts`
    / `supportedConcepts` / `unsupportedConcepts` / `radiusRequestedMeters` / `rawResultCount`
    / `candidateCount` / `observationCount` / `dedupedCount` / `evidenceKeys`. It flows through
    `executePlan` on `providerResults.osm.provenance` unchanged. No raw payloads / secrets /
    preference semantics.
  - Wired into `ExperienceAcquisitionService.executePlan` only. Live tour-generation
    orchestration (`buildAcquisitionPlan` / `executePlan` from `experience-generation.service.ts`)
    is intentionally deferred to Phase 7.
- **Web / exploration (Phase 6)**:
  - `TavilyGroundedSearchService.buildWalkQuery` is theme-aware — the first two
    `requestedThemes` shape the phrase, one query per request (never a theme explosion),
    both language branches, `icónicas`/`iconic` disambiguator kept; no themes → the exact
    legacy phrase. Scoped to Tavily only; other grounded providers untouched.
  - `exploration_style` is a **wizard-sourced, ranking-only** `PreferenceFacet` with the
    real `ExplorationStyle` poles `iconic` / `local_deep_dive` (`BALANCED` → no facet).
    It is matched against the same **explicit dimensioned** `tourism_intensity` /
    `local_character` evidence a candidate already carries — never name / description /
    duration / component count — is soft ranking, never an exclusion, and never touches
    acquisition, source routing, free-text interpretation, or any search query. The LLM
    interpreter is still forbidden from emitting it.

# Next Action

Phase 6 (Tavily walk-query theme-awareness + `exploration_style` ranking facet) is
implemented, verified, and CLOSED at `2d023e1` / `37ad228`. Phase 7 (final live
multi-source acquisition orchestration) has **NOT** started; per the convergence roadmap it
is the prerequisite for the Integration Gate with `feat/agentic-travel-planning`. Next
action will be Phase 7 upon explicit user instruction.

