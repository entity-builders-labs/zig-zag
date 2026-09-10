# Real-catalog selection semantics — characterization (Checkpoint G.1)

**Date:** 2026-09-10
**Branch:** `feat/experience-domain-v2`
**HEAD at start:** `02304665536ec1c11b183ab3b10e3e8838422fb9`
**Task type:** DIAGNOSTIC / CHARACTERIZATION ONLY — no production semantic changes.
**Motivating concern:** in real Rosario / Bahía Blanca bitácoras the engine's final
Experience selection does not visibly respect the user's stated preferences.

## What this is

Ten focused characterization test files under `be/test/characterization/`, run by a
dedicated config (`be/test/jest-characterization.json`, `yarn workspace backend
test:characterization`) that is **not** part of the default `yarn test` / CI suite.
They exercise real production code with deterministic fixtures, real Postgres where
persistence matters (CHAR-8), and fakes only at external boundaries (LangChain in
CHAR-9). Each file pins **current** behavior with green assertions and adds one or
more `it.failing()` blocks that state the invariant the current behavior violates
(they pass only because the body throws under today's code).

No production file was modified. Instrumentation added: none.

| File | Suite | Tests | RED invariants (`it.failing`) |
|---|---|---|---|
| `structured-evidence-semantics.characterization-spec.ts` | CHAR-1 | 5 | — (disagreement pinned across two green tests) |
| `exploration-style-roundtrip.characterization-spec.ts` | CHAR-2 | 5 | 1 |
| `coverage-vs-ranking.characterization-spec.ts` | CHAR-3 | 7 | 1 |
| `bitacora-coverage-contamination.characterization-spec.ts` | CHAR-4 | 3 | 1 |
| `ranking-planner-boundary.characterization-spec.ts` | CHAR-5 | 5 | 1 |
| `quality-signal-roundtrip.characterization-spec.ts` | CHAR-6 | 4 | 1 |
| `shared-component-identity.characterization-spec.ts` | CHAR-7 | 6 | 1 |
| `provider-order-convergence.db.characterization-spec.ts` | CHAR-8 (real PG) | 3 | 1 |
| `specific-request-satisfaction.characterization-spec.ts` | CHAR-9 | 5 | 1 |
| `rosario-like-selection.characterization-spec.ts` | CHAR-10 | 8 | 2 |
| **total** | | **51** | **11** |

`yarn workspace backend test:characterization` → 10 suites, 51 passed.
`yarn workspace backend typecheck` → clean. Lint on `test/characterization/**` → clean.

## Per-test findings

### CHAR-1 — structured evidence → semantic preservation
- `StructuredExperienceCandidateSynthesizerService.synthesizeProposals` hardcodes
  `themes: [] traits: [] intents: []` for every observation, regardless of the OSM
  tags (`historic=monument`, `tourism=museum`), Google Places `primaryType`
  (`historical_landmark`), `wikidata` QID, or rating carried by the
  `SourceObservation`.
- `StructuredCandidateCorroborationService.corroborateAndMerge` only *unions*
  facets, and `[] ∪ [] = []`; the resolver persists the result verbatim.
- Consequence pinned: a facet-less monument scores `evaluateExperiencePreferences`
  `facetMatches[0].matched === false`, `score === 0` for a `theme:history` request,
  while `CoverageAnalyzer` counts the very same row as history coverage
  (`strongMatchCount >= 1`) via its keyword/name/JSON scan. **The two layers
  disagree about the same row.**

### CHAR-2 — exploration-style round-trip
- `candidateMatchesPreferenceFacet` matches an `exploration_style` facet **only**
  against explicit dimensioned evidence for `tourism_intensity` / `local_character`
  (`hasExplicitDimensionedEvidence`: `metadata.dimensionedTraits` /
  `metadata.preferenceFacets` / `metadata.dimensions`).
- The persistence pipeline never produces that shape:
  `resolveOrCreateTraitDefinitions` hardcodes `dimension = 'general'` for every
  relational trait, so a persisted trait `iconic` hydrates as
  `{dimension:'general', key:'iconic'}` → does **not** satisfy
  `exploration_style:iconic` (it *does* satisfy a plain `trait:iconic` facet).
- The synthesizer emits no dimensioned evidence at all.
- Net: `explorationStyle: iconic` and `explorationStyle: local_deep_dive` both add
  one always-unsatisfiable facet to the denominator — a perfect
  history+architecture+walk Experience drops from `score 1.0` to `0.75` under
  either value, **identically**. `explorationStyle` carries zero directional signal
  for a structured-acquired catalog; it only dilutes.
- RED invariant: choosing `iconic` vs `local_deep_dive` must change the preference
  score of at least one structured-acquired Experience.

### CHAR-3 — coverage vs ranking consistency
- `CoverageAnalyzer` theme matching (`matchesThemeKeywords`, `THEME_KEYWORDS`) is
  **accent-naive**: `"Museo Histórico Provincial"` (accented `ó`) does *not*
  substring-match the ASCII keyword `historic`, so it is invisible to coverage;
  `"Historic Provincial Museum"` (same place, no accent) *is* counted. The
  `normalize()` helper that strips diacritics exists in sibling utils but is not
  applied here.
- `"Monumento Nacional"` (`themes: []`) *is* counted for `history` (contains the
  substring `monument`) yet scores `0` in `evaluateExperiencePreferences`.
- RED invariant: coverage and the preference evaluator agree per candidate.

### CHAR-4 — bitácora must not self-contaminate coverage
- `ExperienceGenerationService.buildCandidatePoolTraceStep` builds each offered
  candidate's trace `metadata` as `{ ...experience.metadata, preferenceEvaluation,
  hardExclusionRelaxed }`.
- `buildExperienceCandidatePoolStep` → `matchedThemesFor` → `matchesThemeKeywords`
  then scans `JSON.stringify(candidate.metadata)`. The injected
  `preferenceEvaluation.facetMatches[]` carries the requested theme names as `key`
  values **even when `matched: false`**, so the JSON scan finds them.
- A completely unrelated candidate with `themes: []` and every `facetMatches[].matched
  === false` is reported in the trace with
  `coverageContribution.themes = ['history','culture','architecture']`.
- RED invariant: a candidate whose `preferenceEvaluation` says every requested
  theme `matched:false` must have `coverageContribution.themes = []`.

### CHAR-5 — authoritative ranking must survive the planner boundary
- `rankCandidatesByRelevance` treats `preferenceScore` as a **hard sort tier**
  (`preferenceCompare`, `Number.EPSILON`). For A (`preferenceScore 1.0`, semantic
  0.10) vs B (`preferenceScore 0.2`, semantic 0.95): ranking puts **A first**
  though `A.totalScore = 0.39 < B.totalScore = 1.00`.
- `selectBoundedWindow` re-sorts the final window by `scoreBreakdown.totalScore`
  only → the offered window is **[B, A]** (inverted).
- `PlanningCandidateNormalizerService` emits `semanticScore` / `rankingScore`
  (= `totalScore`) / `qualityScore` (= `qualityBonus`) — **no preference field**.
- `sortCandidatesDeterministically` (greedy order) sorts by `rankingScore ??
  semanticScore` → **[B, A]**. `scoreCandidateForDay` = `semantic·1.0 + quality·0.5
  + dayBalance·0.25` — **no preference term**; day-1 soft score A = 0.35, B = 1.2.
- The candidate the ranking layer put **first** is ordered **last** by the planner.
- RED invariant: the ranking layer's first candidate must not be the planner's last.

### CHAR-6 — quality signal round-trip
- The synthesizer drops Google Places `rating: 4.7` / `userRatingCount: 5321`
  entirely — the `ExperienceCandidate` has no quality field.
- `qualityBonus` for a multi-component ("composite") Experience ignores
  `weightedScore` completely — only `isCurated ? 0.15 : 0`, and acquisition never
  sets `isCurated`. Every multi-stop Experience contributes **0** quality.
- `PlanningCandidateNormalizerService` forwards the **already-weighted**
  `qualityBonus` (0..0.2) as `qualityScore`; `scoreCandidateForDay` multiplies it
  by `qualityWeight = 0.5` again. A perfect 4.7 rating → solver quality term
  `0.094`, **less than the fixed empty-day balance bonus `0.25`**.
- Structured-acquired Experiences always have `qualityScore: null` (confirmed in
  the real bitácora), so the quality contribution is 0 at every downstream stage.
- RED invariant: a Places rating of 4.7 must produce a non-zero quality
  contribution in the planner soft score for a structured-acquired Experience.

### CHAR-7 — shared component ≠ same Experience
- `decideExperienceDedupe`: sharing **one** component of two → `AMBIGUOUS` (via the
  `componentOverlap >= 0.5` branch). A human-obvious alias with an **identical**
  single component (`"…Visit"` vs `"…Visit — Rosario"`, `nameSimilarity 0.75`) is
  **still only `AMBIGUOUS`** — `SAME` requires either exact normalized name +
  exact component structure, or `nameSimilarity ≥ 0.86 ∧ semantic ≥ 0.72 ∧
  roleAware ≥ 0.8`.
- `filterOverlappingExperienceCandidates.preferWinner` compares **component count
  first**, `rankingScore` only as a tie-break. A `rankingScore 0.95` 2-stop walk
  that contains the shared landmark is **excluded** (`REDUNDANT_WITH_OTHER_CANDIDATE`)
  in favour of a `rankingScore 0.30` 4-stop circuit that merely includes the same
  landmark as one of its stops. This matches the real Rosario observation: the
  tightly-relevant "Monumento a la Bandera + Caminata" lost to a sprawling
  historical route.
- RED invariant: when two overlapping candidates differ by only one shared
  component, the higher-`rankingScore` one must survive.

### CHAR-8 — provider order must converge (real Postgres)
- `ExperienceCatalogService.mergeMetadata` = shallow `{ ...left, ...right }`
  (incoming wins per top-level key).
- Same Experience, two providers. **RUN 1** persist empty-facets then rich →
  canonical `metadata` = `{themes:[history,architecture], traits:[guided_tour],
  intents:[walk]}` (rich survives). **RUN 2** (DB reset) persist rich then empty →
  canonical `metadata` = `{themes:[], traits:[], intents:[]}` — the rich arrays are
  overwritten by the incoming empty arrays.
- The canonical Experience's facets depend entirely on acquisition order.
- RED invariant: identical canonical Experience regardless of provider order.

### CHAR-9 — specific free-text request satisfaction
- `PreferenceInterpreterService.interpret("Quiero visitar Landmark Alpha")` (real
  service, faked LangChain transport): the phrase survives **only** as free text in
  `positiveSemanticQuery`. `NormalizedPreferenceIntent` has no
  named-target / required-place field; the controlled-vocabulary facet normalizer
  emits nothing for a bare proper noun.
- `CoverageAnalysisInput` has **no** free-text / named-target channel — only
  `requestedThemes/Traits/Intents`.
- With generic history+architecture coverage already sufficient, Request 2
  (history + architecture + `additionalPreferences: "Quiero visitar Landmark
  Alpha"`) produces a **byte-identical** coverage decision to Request 1
  (`action: 'none'`, `requiresAdditionalDiscovery: false`). "Landmark Alpha" is
  never specifically sought.
- RED invariant: a concrete "Quiero visitar X" request must be able to change
  acquisition when X is absent from the catalog.

### CHAR-10 — realistic Rosario-like selection regression
Deterministic 60-row catalog through the real chain (`rankCandidatesByRelevance` →
`selectBoundedWindow` → `filterOverlappingExperienceCandidates`). Request: history
+ culture + architecture, `explorationStyle: iconic`, `additionalPreferences:
"Quiero visitar el Monumento a la Bandera"`. No Rosario-specific production code.

- **A/B — named landmark never reaches the window.** The standalone "Monumento a la
  Bandera" is facet-less (CHAR-1) → `preferenceScore 0.2` (only the generic
  `intent:visit` matches; real history rows score `0.8`). It ranks **59 / 60** and
  is absent from the 15-window.
- **B — where it is lost:** at ranking, before the window. The only offered
  candidate that contains the landmark is a 4-stop "Circuito Histórico" kept purely
  on component count (CHAR-7). The user's named place appears, if at all, buried in
  a circuit they did not ask for.
- **C — sports vs history:** the hard preference tier **does** protect faceted
  history rows (first sports row at rank 44, last history row at rank 21) — so a
  sports-only row cannot outrank a *faceted* history row. But the *facet-less*
  monument shares the sports tier (`preferenceScore` ~0), which is why it sinks.
- **D — iconic → local_deep_dive:** the selected window is **identical** for both
  (CHAR-2: no dimensioned evidence to discriminate on).
- **E — trace fidelity:** `matchedThemesFor` is a `JSON.stringify` scan, so a
  sports row whose free-text mentions "historic culture and architecture district"
  is reported as covering all three themes it never structurally matched (CHAR-4).
- **F — determinism:** the whole chain is stable across runs.
- RED invariants: (1) a user who names "Monumento a la Bandera" gets it (standalone)
  in the window; (2) changing `explorationStyle` changes the selected set for an
  iconic-heavy request.

### CHAR-11 (optional) — free-text transport integrity — NOT IMPLEMENTED
Deferred: `fe/components/tours/TourWizardForm.tsx` is under active edit by a
concurrent session. **Counter-evidence that the frontend is not the defect:** the
real tour `e2b1a23d-833b-4f47-835c-d9ba50948e26` persisted
`additionalPreferences: "Monumento a la bandera"` end-to-end into
`tour.metadata`. Free-text transport works; every defect above is downstream of it.

## Root-cause groups

### A — SEMANTIC REPRESENTATION GAP
Structured providers carry objective facts (OSM tags, Places `primaryType`,
`wikidata`, `rating`) that never become Experience semantics. The synthesizer is
"strictly mechanical" (`themes/traits/intents/dimensionedTraits = []`,
`qualityScore` unset); no derivation stage exists; corroboration can only union;
persistence stores verbatim. → CHAR-1, CHAR-2, CHAR-6, CHAR-10-A.

### B — PREFERENCE SEMANTICS INCONSISTENCY
At least three incompatible definitions of "does this Experience satisfy X":
1. `candidateMatchesPreferenceFacet` — exact normalized match on `themes[]` /
   `intents[]` / `traits[]` (+ dimensioned evidence for structured dims).
2. `CoverageAnalyzer` — accent-naive keyword expansion + name + `JSON.stringify(
   metadata)` substring scan.
3. `matchedThemesFor` (bitácora) — `JSON.stringify(metadata)` scan that now also
   sees the injected `preferenceEvaluation` diagnostic blob.
They disagree per candidate and per layer. → CHAR-2, CHAR-3, CHAR-4, CHAR-10-C/E.

### C — RANKING BOUNDARY LOSS
The authoritative `preferenceScore` hard tier from `rankCandidatesByRelevance` is
discarded twice: `selectBoundedWindow`'s final `totalScore` re-sort, and the
planner contract (`PlanningExperienceCandidate` has no preference field →
`sortCandidatesDeterministically` + `scoreCandidateForDay` are preference-blind).
→ CHAR-5, CHAR-10-A/C.

### D — CATALOG CONVERGENCE / IDENTITY
`mergeMetadata` shallow-merge is order-sensitive (rich → `[]` regression);
`decideExperienceDedupe` leaves obvious aliases in `AMBIGUOUS`;
`filterOverlappingExperienceCandidates` prefers component count over user
relevance. → CHAR-7, CHAR-8, CHAR-10-B.

### E — SPECIFIC USER INTENT SATISFACTION
No representation anywhere (`NormalizedPreferenceIntent`, `CoverageAnalysisInput`,
`selectBoundedWindow`) of "the user named a concrete place/thing". Free text lands
only in `positiveSemanticQuery` as a soft semantic nudge — it cannot trigger
acquisition or guarantee inclusion. → CHAR-9, CHAR-10-E.

### F — QUALITY SIGNAL GAP
`rating` dropped at synthesis; `qualityScore` never set by acquisition; composites
ignore quality entirely; the normalizer double-attenuates the already-weighted
bonus. → CHAR-6, CHAR-10.

## What is definitely broken (bugs, not design choices) — RECORDED, NOT FIXED

1. **Bitácora coverage self-contamination (CHAR-4).** `matchedThemesFor` /
   `matchesThemeKeywords` scan a metadata object that now contains the injected
   `preferenceEvaluation` (requested theme names as `facetMatches[].key`, even
   `matched:false`). The trace claims coverage a candidate explicitly failed.
   Small fix: strip `preferenceEvaluation` / `hardExclusionRelaxed` before the
   scan, or scan the Experience's own facets.
2. **Order-dependent metadata merge (CHAR-8).** An incoming empty `[]` overwrites a
   populated `themes/traits/intents` array in `mergeMetadata`.
3. **Accent-naive coverage keyword matching (CHAR-3).** `matchesThemeKeywords` /
   `THEME_KEYWORDS` don't apply the diacritic-stripping `normalize()` that sibling
   utils use; Spanish catalog names go uncounted.
4. **Quality contract mismatch (CHAR-6).** `PlanningCandidateNormalizerService`
   labels the already-weighted `qualityBonus` (0..0.2) as `qualityScore`, and the
   solver applies `qualityWeight` to it again.
5. **Trait dimension always `'general'` (CHAR-2).** `resolveOrCreateTraitDefinitions`
   hardcodes `dimension = 'general'`, making `tourism_intensity` /
   `local_character` / `exploration_style` matching structurally impossible for any
   trait-sourced evidence, even though the dimension taxonomy exists.

## What is still a product / design decision (NOT decided here)

- Whether a positive preference (a theme, or a named place) may ever be
  **required**. `CLAUDE.md` states interest chips are pure-soft *by design*
  ("matches how comparable AI itinerary tools treat interest chips, recovering via
  post-generation editing"). CHAR-9 / CHAR-10-invariant-1 ("user gets the place
  they named") is a product call.
- Whether `exploration_style` should fall back to name/description/theme signals
  when no dimensioned evidence exists, or whether providers must emit dimensioned
  facets.
- Whether the synthesizer *should* derive `themes/traits` from OSM tags / Places
  types, or whether a separate enrichment stage owns that (and how aggressively).
- Whether "a composite subsumes the POI it contains" is right when that POI is
  exactly what the user asked for.
- Which of the three preference-match definitions becomes canonical.
- Whether quality is a raw 0..5 scale end-to-end or a normalized 0..1.

## Minimum coherent fix surface (described, NOT implemented)

Ordered; `#1`+`#2` must land together (coverage would otherwise get stricter with
no backfill to compensate). `#6` is product-gated.

### 1. One preference-match primitive
- **Layers:** `theme-matching.util.ts`, `coverage-analyzer.service.ts`,
  `generation-trace-builder.util.ts`.
- **Change:** both `CoverageAnalyzer` and `matchedThemesFor` delegate
  theme/trait/intent matching to a single shared `experienceSatisfies(dimension,
  key)` that `candidateMatchesPreferenceFacet` also uses. Diagnostic blobs
  (`preferenceEvaluation`) are never part of the corpus.
- **Tests addressed:** CHAR-3, CHAR-4, CHAR-10-C/E; consistency half of CHAR-1.
- **New abstraction:** one small shared matcher module (removes code paths).
- **Overfitting risk:** low.
- **DB migration:** none.

### 2. Structured-facet derivation stage (between synthesis and persistence)
- **Layers:** new `deriveStructuredFacets(observation)` util invoked by
  `StructuredExperienceCandidateSynthesizerService` (or a new
  `StructuredFacetEnrichmentService`); `experience-catalog.service.ts`
  (`resolveOrCreateTraitDefinitions` stops hardcoding `'general'`).
- **Change:** deterministic mapping OSM `historic=*` / `tourism=museum` / Places
  `primaryType` → `themes[]`; `wikidata` + `wikipedia` + high `userRatingCount` →
  `metadata.dimensionedTraits: [{tourism_intensity, iconic|popular}]`, absence →
  `hidden|local`.
- **Tests addressed:** CHAR-1, CHAR-2, CHAR-10-A/D.
- **New abstraction:** yes — an OSM/Places → facet ontology table.
- **Overfitting risk:** medium — mitigate by mapping from a documented public-tag
  ontology, not from fixture strings; keep the table small and reviewed.
- **DB migration:** none (writes existing `metadata` JSON; optionally real
  `TraitDefinition` rows once dimensions are populated).

### 3. Carry preference through the planner boundary
- **Layers:** `daily-planning.interface.ts` (add `preferenceScore` to
  `PlanningExperienceCandidate`), `planning-candidate-normalizer.service.ts`,
  `candidate-window-selection.util.ts` (final sort key
  `(preferenceScore desc, totalScore desc)`), `daily-planning-candidate-sort.util.ts`,
  `daily-planning-placement.util.ts`, `daily-planning-policy.config.ts` (new
  `preferenceWeight` or an explicit tier).
- **Tests addressed:** CHAR-5, CHAR-10-A/C.
- **New abstraction:** none (one field + one weight).
- **Overfitting risk:** low.
- **DB migration:** none.

### 4. Fix the quality contract
- **Layers:** `planning-candidate-normalizer.service.ts` (pass raw
  `experience.qualityScore`, not `scoreBreakdown.qualityBonus`),
  `candidate-ranking.util.ts` (`qualityBonus` for composites uses `weightedScore`),
  synthesizer + resolver (`VerifiedExperienceInput.qualityScore` from Places
  `rating` — ties to `#2`).
- **Change:** pick one scale (recommend raw 0..5 through the planner) and apply
  the weight exactly once.
- **Tests addressed:** CHAR-6, CHAR-10.
- **New abstraction:** none.
- **Overfitting risk:** low.
- **DB migration:** none (`Experience.qualityScore` column already exists).

### 5. Order-independent metadata merge
- **Layers:** `experience-catalog.service.ts` (`mergeMetadata`).
- **Change:** union array-valued keys (`themes/traits/intents/dimensionedTraits`);
  prefer non-empty scalars; never let an empty incoming array clear a populated
  one.
- **Tests addressed:** CHAR-8.
- **New abstraction:** small helper.
- **Overfitting risk:** low.
- **DB migration:** none (a one-time backfill of already-flattened rows is a
  separate optional task).

### 6. (PRODUCT-GATED) Represent a named / anchored request
- **Layers:** `PreferenceInterpreterService` (+ a `place` facet dimension or an
  `anchoredPlaces: string[]` field on `NormalizedPreferenceIntent`),
  `coverage-analysis.interface.ts` + `CoverageAnalyzer` (anchored place as a
  coverage requirement), `ExperienceDiscoveryPlannerService` (targeted query),
  `selectBoundedWindow` (reserve a slot).
- **Tests addressed:** CHAR-9, CHAR-10-invariant-1.
- **New abstraction:** yes — a new intent dimension end-to-end.
- **Overfitting risk:** medium-high.
- **DB migration:** none.
- **Status:** DO NOT BUILD without product sign-off — it contradicts the
  documented "positive preferences are always soft" invariant.

## Verification performed

- `yarn workspace backend test:characterization` — 10 suites / 51 tests pass
  (against `zigzag_test`; CHAR-8 uses real Postgres via
  `be/test/integration/support/test-db.ts`).
- `yarn workspace backend typecheck` — clean.
- `npx eslint test/characterization/**` — clean.
- No production file changed → default `yarn test` / `test:e2e` / `test:integration`
  / `test:acceptance` behavior is unaffected by construction. The known
  concurrent-session `lint:check` failures in `apple-token.service.spec.ts` /
  `auth.service.spec.ts` are pre-existing and unrelated.

## Not done / out of scope

- No production semantic change, no schema change, no fix implemented.
- CHAR-11 (frontend transport spec) deferred — file under concurrent edit; real
  tour `e2b1a23d` already demonstrates the transport works.
- Phase 7 status unchanged.
