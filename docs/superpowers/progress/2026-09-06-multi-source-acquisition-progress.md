# Multi-source Experience acquisition — progress

Canonical design: `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`
Implementation plan: `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md`

# Current State

- Branch: `feat/experience-domain-v2`
- Current milestone: Phase 2 — Preference Facets & Deterministic Importance Mapping (CLOSED & VERIFIED)
- Verified base commit: `7441a78664e2a41bceffe588817d8c4e40e8b4d5` (Phase 1 hardening commit)
- Last verified test state: backend Jest `111/111` suites and `760/760` tests passing (baseline was `110/110` suites, `747/747` tests; +1 new suite, +13 tests, zero regressions).
- Linting: `yarn lint:check` is 100% clean (0 errors, 0 warnings).
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
  - Updated `be/test/experience-selection-scale.e2e-spec.ts` `normalizedIntent` helper.

# In Progress

None. Phase 2 is complete.

# Not Started

- Phase 3: Deterministic Corroboration / acquisition planning foundation.
- Phase 4: Google Places cutover.
- Phase 5: Proactive OSM.
- Phase 6: Tavily + explorationStyle.
- Phase 7: Final orchestration / acceptance.

# Verification

- `yarn test` (`be/`): PASS — 111 suites, 760 tests passing (zero regressions, +1 suite, +13 tests).
- `yarn lint:check` (`be/`): PASS — 0 errors, 0 warnings across entire codebase.
- `yarn run check` (`be/`): TypeScript compilation in `be/src/` has 0 errors; `yarn build` completed cleanly.
- Explainability verified: `PreferenceEvaluation.facetMatches` correctly captures all 7 audit fields for real facets; trace candidate decisions preserve breakdown.

# Important Decisions / Invariants

- **Checkpoint Convention**:
  - `Verified code commit`: Commit whose code, types, and tests were actually executed and verified.
  - `Verified base commit`: Base commit on which changes were developed and verified.
  - `Checkpoint commit`: Optional informational field only when referring to an already-existing documentation or tracking commit. Never embed the self-referential commit SHA within its own commit.
- **`facetMatches` Invariant**: Contains only genuine `PreferenceFacet` records. Dietary, accessibility, budget, and group constraints participate in `positiveRatio` with fixed weight 1.0, but never manufacture synthetic `PreferenceFacet` entries.
- **Canonical Facet Keys**: Free-text terms (in Spanish or English) and synonyms are normalized into canonical domain keys (`canonicalizeFacetKey`), preventing duplicate language-specific facet keys.
- **Strict Wizard Precedence**: Wizard facets always have `importance: 1.0, confidence: 1.0, source: 'wizard'`. Free-text facets matching the same compound `${dimension}:${key}` are discarded and cannot lower wizard weights.
- **Exploration Style Dormancy**: `exploration_style` remains reserved in vocabulary but dormant until Phase 6 rollout.
- **Scope Isolation**: No corroboration merge, no Google Places cutover, no OSM provider, no Tavily changes, and no Prisma migrations in Phase 2.

# Next Action

Phase 2 is complete. Stop before Phase 3. Next action will be Phase 3 (Deterministic Corroboration / acquisition planning foundation) upon user instruction.
