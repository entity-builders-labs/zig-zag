# Multi-source Experience acquisition — progress

Canonical design: `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`

# Current State

- Branch: `feat/experience-domain-v2`
- Current milestone: Phase 3 — Deterministic Corroboration + Acquisition Planning Foundation (FINAL HARDENING VERIFIED)
- Final verified Phase 3 code commit: `8415df6d2e6fdd32ee4a04a3d729f3d5ea93dc24`
- Previous Phase 3 hardening code commit: `0dff08f7f8c3df11f04e48a5b9d1339a3836bdbb`
- Previous Phase 3 initial code commit: `34a543451575d28e446638f389474ff91e724a2e`
- Verified base HEAD: `1b702fcff99c61f36578db9f58bdd6e193e8b68e`
- Previous Phase 2 code commit: `f12b2d56dada8a6db7bfc2e2308ea45366426955`
- Last verified test state: backend Jest `116/116` suites and `831/831` tests passing (baseline was `113/113` suites, `792/792` tests; +3 new suites, +39 tests, zero regressions).
- Linting: `yarn lint:check` is 100% clean (0 errors, 0 warnings across `{src,apps,libs,test}/**/*.ts`).
- Typecheck: `yarn run check` introduces zero new errors beyond the known acceptance-fixture baseline; `yarn build` is 100% clean.

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
  - Maps `WikivoyageEntry` into provider-neutral `SourceObservation` with stable evidenceKey (`wikivoyage:${articleSlug}:${entrySlug}`).
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
  - Updated `WikivoyageAcquisitionProvider.acquire()` to format collision-resistant `evidenceKey`:
    - `wikivoyage:${articleSlug}:wikidata:${qid}` when `entry.wikidata` matches `/^Q\d+$/i`.
    - `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}` with deterministic duplicate occurrence tracking per normalized key.
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

# In Progress

None. Phase 3 final hardening, validation, and checkpoint are complete.

# Not Started

- Phase 4: Google Places cutover.
- Phase 5: Proactive OSM.
- Phase 6: Tavily + explorationStyle.
- Phase 7: Final orchestration / acceptance.

# Verification

- `yarn test --runInBand` (`be/`): PASS — 116 suites, 831 tests passing (zero regressions, +3 suites, +39 tests over Phase 2).
- `yarn run lint:check` (`be/`): PASS — 0 errors, 0 warnings across `{src,apps,libs,test}/**/*.ts`.
- `yarn build` (`be/`): PASS — nest build completes cleanly.
- Targeted Phase 3 test suites: PASS — 48/48 tests passing across all 5 targeted suites (`wikivoyage-acquisition.provider.spec.ts` (6), `structured-candidate-corroboration.service.spec.ts` (13), `experience-acquisition-planner.service.spec.ts` (14), `real-world-entity-matching.util.spec.ts` (6), `structured-experience-candidate-synthesizer.service.spec.ts` (9)).
- Scenario coverage: Scenarios A through M (corroboration) and M through T (acquisition planning) fully covered by automated unit tests.

# Important Decisions / Invariants

- **Checkpoint Convention**:
  - `Verified code commit`: Commit whose code, types, and tests were actually executed and verified.
  - `Verified base HEAD`: Base commit on which changes were developed and verified.
  - `Checkpoint commit`: Optional informational field only when referring to an already-existing documentation or tracking commit. Never embed the self-referential commit SHA within its own commit.
- **Evidence Identity vs Entity Identity**:
  - `evidenceKey` is strictly listing-specific and collision-resistant: `wikivoyage:${articleSlug}:${section}:${template}:${entrySlug}:${occurrence}`.
  - Normalized Wikidata QID identifies real-world entities and is stored in `externalId`.
  - Distinct listings with identical QID do not collide on `evidenceKey`.
- **Corroboration Decisions**:
  - Allowed decisions: `SAME`, `NEW`, `AMBIGUOUS`.
  - `AMBIGUOUS` is NEVER force-merged into `SAME` or `NEW`.
  - Real-world entity reconciliation radius: 150 meters.
  - Conservative complete-link clustering prevents false merges under transitive conflicts.
  - Single-place component hint collapse: merging two single-place proposals yields exactly 1 `GeoEntityHint` on the resulting candidate only when `role` and `expectedKind` match.
  - Activity-like observations (`tourism_activity`, `route`, `operator`, `editorial`) are never merged with places even if they share coordinates or Wikidata QID.
- **Acquisition Planning & Routing**:
  - Canonical contract: `ExperienceAcquisitionPlan` with discriminated `SourcePlan[]`.
  - Canonical Phase 2 active dimensions only (`theme`, `intent`, `winery_scale`, `tourism_intensity`, `nature_type`, `local_character`).
  - Single web query guarantee: at most ONE web query per acquisition pass using plain space-separated keywords.
  - `exploration_style` remains strictly dormant until Phase 6 rollout; if all deficits are dormant, `sourcePlans: []` is returned.
  - Unknown dimensions fallback to web only (never pollute OSM or Places).
- **Scope Isolation**:
  - Phase 3 does NOT execute Google Places, OSM, or web providers through the new orchestration yet.
  - `ExperienceCandidate` remains the downstream boundary (no provider scores, coordinates, or source weights added to it).
  - Resolver, geographic validator, dedupe, embeddings, ranking, solver, and planner are untouched.

# Next Action

Phase 3 is fully implemented, verified, and complete. Stop before Phase 4. Next action will be Phase 4 (Google Places cutover into the acquisition framework) upon user instruction.

