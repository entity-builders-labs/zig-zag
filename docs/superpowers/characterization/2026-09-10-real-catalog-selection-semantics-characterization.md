# Real-catalog selection semantics — characterization (Checkpoint G.1)

**Date:** 2026-09-10 (hardening pass same day)
**Branch:** `feat/experience-domain-v2`
**HEAD at G.1 start:** `02304665536ec1c11b183ab3b10e3e8838422fb9`
**HEAD at hardening-pass start:** `7654e3b7ece49129a367a5ac115c621527a2c163`
**Task type:** DIAGNOSTIC / CHARACTERIZATION ONLY — no production semantic changes.
**Motivating concern:** in real Rosario / Bahía Blanca bitácoras the engine's final
Experience selection does not visibly respect the user's stated preferences.

## What this is

Characterization test files under `be/test/characterization/`, run by a dedicated
config (`be/test/jest-characterization.json`, `yarn workspace backend
test:characterization`) that is **not** part of the default `yarn test` / e2e /
integration / acceptance CI (regex isolation proven below). They exercise real
production code with deterministic fixtures, **real Postgres** where persistence
matters, and fake only external boundaries (the LLM transport in CHAR-9). Each file
pins **current** behavior with green assertions; `it.failing()` blocks are reserved
for **definite implementation defects** (they pass only because the body throws
under today's code). Unresolved product questions are pinned as green
`PRODUCT HYPOTHESIS` / `OPEN POLICY` tests, never as `it.failing`.

No production file was modified. The only non-test change is a new test-support
file that reuses the existing `assertDisposableDatabase` guard (see DB safety).

| File | Suite | Tests | RED (`it.failing`) — defects only |
|---|---|---|---|
| `structured-evidence-semantics.characterization-spec.ts` | CHAR-1 (pure) | 5 | — |
| `catalog-roundtrip.db.characterization-spec.ts` | CHAR-1/2/6 DB | 5 | 2 |
| `exploration-style-roundtrip.characterization-spec.ts` | CHAR-2 (pure) | 5 | — |
| `coverage-vs-ranking.characterization-spec.ts` | CHAR-3 | 7 | 1 |
| `bitacora-coverage-contamination.characterization-spec.ts` | CHAR-4 | 3 | 1 |
| `ranking-planner-boundary.characterization-spec.ts` | CHAR-5 | 5 | 1 |
| `quality-signal-roundtrip.characterization-spec.ts` | CHAR-6 (pure) | 4 | 1 |
| `shared-component-identity.characterization-spec.ts` | CHAR-7 | 6 | — |
| `provider-order-convergence.db.characterization-spec.ts` | CHAR-8 (real PG) | 3 | 1 |
| `specific-request-satisfaction.characterization-spec.ts` | CHAR-9 | 7 | — |
| `rosario-like-selection.characterization-spec.ts` | CHAR-10 | 8 | — |
| **total** | | **58** | **7** |

`yarn workspace backend test:characterization` (against `zigzag_test`) → 11 suites,
58 passed. `yarn workspace backend typecheck` → clean. `eslint test/characterization/**`
→ clean.

RED count dropped from 10 (initial G.1) to 7 after reclassification — three RED
"invariants" (CHAR-2 iconic-vs-local, CHAR-7 overlap winner, CHAR-9/10 named place)
were not settled invariants and are now green `PRODUCT HYPOTHESIS` tests. This is a
deliberate accuracy improvement, not a loss of findings.

## Database safety

`be/test/characterization/support/db.ts` (new, test-only) wraps the existing
`be/test/support/assert-disposable-database.ts` guard:
- `getGuardedCharacterizationPrisma()` calls `assertDisposableDatabase(process.env.DATABASE_URL)`
  **before** connecting;
- `resetCharacterizationDb(db)` re-asserts the guard **immediately before** every
  `TRUNCATE ... RESTART IDENTITY CASCADE` (defence in depth).

Both DB specs (`provider-order-convergence.db`, `catalog-roundtrip.db`) use only
these wrappers.

Proof:
- `DATABASE_URL=postgresql://…/zigzag yarn test:characterization -t provider-order-convergence`
  → **fails before any TRUNCATE** with
  `Refusing to TRUNCATE a database that is not provably disposable (localhost:5432/zigzag).`
- `DATABASE_URL=postgresql://…/zigzag_test yarn test:characterization -t provider-order-convergence`
  → passes (3/3).
- CI's documented opt-in `ALLOW_DESTRUCTIVE_TEST_DB=1` is still honoured by the
  shared guard (unchanged).

No change to `be/test/integration/support/test-db.ts` or the broader DB-hardening
plan.

## Regex isolation (evidence)

`jest --config <cfg> --listTests` on this branch:
- `jest-characterization.json` → exactly the 11 files above.
- `jest-e2e.json` (`testRegex: ".e2e-spec.ts$"`) → **no** characterization file.
- `jest-integration.json` (`integration/.*\.integration-spec\.ts$`) → **no** characterization file.
- `jest-acceptance.json` (`acceptance/.*\.(…|spec|…)\.ts$`) → **no** characterization file.
- default unit config (rootDir `src`, `.spec.ts`) → **no** characterization file.

## Per-test findings

### CHAR-1 — structured evidence → semantic preservation

**Pure (`structured-evidence-semantics.characterization-spec.ts`):**
`StructuredExperienceCandidateSynthesizerService.synthesizeProposals` hardcodes
`themes/traits/intents = []` for every observation regardless of OSM tags / Places
`primaryType` / `wikidata` / rating. `StructuredCandidateCorroborationService`
only unions facets (`[] ∪ [] = []`). A facet-less monument scores
`evaluateExperiencePreferences` `score 0` for `theme:history`, while
`CoverageAnalyzer` counts the same row as history coverage — the two layers
disagree.

**DB round-trip (`catalog-roundtrip.db.characterization-spec.ts`, CHAR-1 DB):**
the same OSM historic-monument observation, run through
synthesize → corroborate → real `resolveOrCreateTraitDefinitions` +
`persistVerifiedExperience` (real Prisma transaction, metadata shape copied
verbatim from `ExperienceProposalResolverService`) → `findVerifiedByIds`
(`projectVerifiedExperienceRow`), still hydrates with `themes=[] traits=[]
intents=[]` and still scores `0` for `theme:history`. **The information is absent
after real persistence + hydration, not merely after synthesis.** Only the
hint→GeoEntity geocoding is faked (GeoEntity created from the observation's own
coordinates).

### CHAR-2 — exploration-style semantics

**Pure (`exploration-style-roundtrip.characterization-spec.ts`):**
`candidateMatchesPreferenceFacet` matches `exploration_style` **only** against
explicit dimensioned evidence for `tourism_intensity` / `local_character`
(hand-authored `syntheticDimensionedExperience`, clearly labelled). A relational
trait carried as `{dimension:'general', key:'iconic'}` does NOT satisfy
`exploration_style:iconic` but DOES satisfy `trait:iconic`. The synthesizer emits
no dimensioned evidence, so a synthesized structured candidate scores identically
under `iconic` and `local_deep_dive` — the field only DILUTES `positiveRatio`
(1.0 → 0.75 under either value). *No factual tag→facet claim is made — the
fixtures are `structuredLandmarkAObservation` / `structuredPlaceBObservation`.*

**DB round-trip (`catalog-roundtrip.db`, CHAR-2 DB):**
real `resolveOrCreateTraitDefinitions(['iconic'])` writes
`TraitDefinition.dimension === 'general'` (asserted directly against the row);
after `persistVerifiedExperience` + `findVerifiedByIds` the hydrated
`dimensionedTraits` contains `{dimension:'general', key:'iconic'}` and nothing at
`tourism_intensity`; the hydrated row fails `exploration_style:iconic` and passes
`trait:iconic`. **RED (`it.failing`):** a trait whose key names a structured
dimension value should be resolvable by that dimension after persist+hydrate.

### CHAR-3 — coverage vs ranking consistency
`CoverageAnalyzer` theme matching (`matchesThemeKeywords` / `THEME_KEYWORDS`) is
accent-naive — `"Museo Histórico Provincial"` (accented `ó`) is not counted for
`history`; `"Historic Provincial Museum"` is. `"Monumento Nacional"` (`themes:[]`)
IS counted (`monument` substring) yet scores `0` in `evaluateExperiencePreferences`.
**RED:** coverage and the preference evaluator agree per candidate.

### CHAR-4 — bitácora must not self-contaminate coverage
`buildCandidatePoolTraceStep` builds each offered candidate's trace `metadata` as
`{ ...experience.metadata, preferenceEvaluation, hardExclusionRelaxed }`.
`buildExperienceCandidatePoolStep → matchedThemesFor → matchesThemeKeywords`
scans `JSON.stringify(metadata)`, which now contains
`preferenceEvaluation.facetMatches[].key` — the requested theme names, even with
`matched:false`. A wholly unrelated candidate (`themes:[]`, every facet
`matched:false`) is reported with
`coverageContribution.themes = ['history','culture','architecture']`. **RED:** a
candidate whose `preferenceEvaluation` says every requested theme `matched:false`
must have `coverageContribution.themes = []`.

### CHAR-5 — authoritative ranking across the planner boundary
`rankCandidatesByRelevance` treats `preferenceScore` as a hard sort tier. For
A (`preferenceScore 1.0`, semantic 0.10) vs B (`0.2`, semantic 0.95): ranking puts
A first (`A.totalScore 0.39 < B.totalScore 1.00`). Then:
- `selectBoundedWindow` re-sorts the window by `totalScore` only → **[B, A]**;
- `PlanningCandidateNormalizerService` emits `semanticScore` / `rankingScore`
  (= `totalScore`) / `qualityScore` — **no preference field**;
- `sortCandidatesDeterministically` (greedy order) sorts by
  `rankingScore ?? semanticScore` → **[B, A]**;
- `scoreCandidateForDay` has **no preference term** — day-1 soft score A 0.35, B 1.2.

**Precise classification:** this is an **ordering** loss (the strongly-preferred
candidate is ordered last), demonstrated as far as the greedy sort and the
per-day soft score. This suite does not assert that A is ultimately *dropped* from
a full multi-day plan — CHAR-10's end-to-end run shows both survivors and the
circuit get scheduled when capacity allows. Whether "the authoritative ranking
tier must survive into candidate selection" is the intended contract is the
question the fix review must settle; the mechanism (no preference signal past the
normalizer) is a definite implementation gap. **RED:** the ranking layer's first
candidate must not be ordered last by the greedy planner.

### CHAR-6 — quality signal round-trip

**Pure (`quality-signal-roundtrip.characterization-spec.ts`):**
- the synthesizer carries no quality field — Places `rating` is dropped at hop 1;
- `qualityBonus` for a multi-component ("composite") Experience ignores
  `weightedScore` entirely (only `isCurated ? 0.15 : 0`; acquisition never sets
  `isCurated`) → **0** for every multi-stop Experience;
- `PlanningCandidateNormalizerService` forwards the already-weighted `qualityBonus`
  (0..0.2) as `qualityScore`; `scoreCandidateForDay` multiplies by
  `qualityWeight 0.5` again → a 4.7 rating contributes `0.094`, less than the
  fixed empty-day balance bonus (0.25).

**DB round-trip (`catalog-roundtrip.db`, CHAR-6 DB):** a Google Places observation
with `rating 4.7`, run through the real synthesize→persist path, persists with
`Experience.qualityScore === null` (asserted on the raw row and the hydrated
projection). **RED (pure):** a 4.7 rating must produce a non-zero planner quality
term for a structured-acquired Experience. **RED (DB):** a Places rating must reach
`Experience.qualityScore` through the real acquisition/persist path.

### CHAR-7 — shared component ≠ same Experience
- `decideExperienceDedupe`: one shared component of two → `AMBIGUOUS`; a
  human-obvious alias with an identical single component is still only `AMBIGUOUS`
  (needs near-exact normalized name for `SAME`). **This is evidence** and is kept
  as a green characterization.
- `filterOverlappingExperienceCandidates.preferWinner` compares component count
  **before** `rankingScore`: a `rankingScore 0.95` 2-stop walk is excluded in
  favour of a `rankingScore 0.30` 4-stop circuit sharing one component; a
  standalone POI is subsumed by any composite containing it.
- **Reclassified:** the former RED "the higher-`rankingScore` one must survive" is
  now a green `OPEN POLICY` test. The definite finding is *"current overlap policy
  prefers component count over user relevance"*; whether that is wrong is a
  product/planning decision.

### CHAR-8 — provider order must converge (real Postgres)
`ExperienceCatalogService.mergeMetadata` = shallow `{ ...left, ...right }`. Same
Experience, two providers: **RUN 1** empty→rich = rich survives; **RUN 2**
rich→empty = the rich arrays are overwritten with `[]`. The canonical Experience's
facets depend entirely on acquisition order. **RED:** identical canonical
Experience regardless of provider order. *(Now guarded — see DB safety.)*

### CHAR-9 — specific free-text request satisfaction
Exercises the **real** decision path: `PreferenceInterpreterService.interpret`
(real service, faked LLM transport) → real `getFacetKeysByDimension` /
`normalizeWizardFacet` `requestedThemes` derivation → real `CoverageAnalyzer.analyze`
→ real `ExperienceAcquisitionPlannerService.buildAcquisitionPlan`.

- `"Quiero visitar Landmark Alpha"` yields **no** controlled facet — free text
  only in `positiveSemanticQuery`;
- **Request A** (history+architecture, generic-sufficient catalog): coverage
  `action:'none'` → the acquisition loop `break`s → planner never invoked;
- **Request B** (same + the free text, catalog lacks "Landmark Alpha"):
  `requestedThemes` unchanged → coverage still `action:'none'` → planner never
  invoked;
- **Request C** (same as B, catalog now *contains* a row named "Landmark Alpha"):
  **byte-identical** coverage decision to B — the named place existing or not is
  invisible to coverage/acquisition;
- `buildAcquisitionPlan` with **zero deficits** + a `semanticQuery` mentioning
  "Landmark Alpha" → `sourcePlans: []` (free text alone cannot trigger
  acquisition);
- `positiveSemanticQuery` reaches acquisition **only as a rider** on an
  independent structural deficit: with a missing `theme:tango` deficit the web
  `sourcePlan.query` becomes `"Testville tango Quiero visitar Landmark Alpha"`.

**Reclassified:** no `it.failing`. The definite finding — *"there is no structured
channel for a named concrete request; the free text is a semantic rider only"* —
is pinned green. Whether "Quiero visitar X" should carry more weight (soft
interest vs "sí o sí") is an OPEN PRODUCT DECISION, pinned as a labelled
`PRODUCT HYPOTHESIS` test.

### CHAR-10 — realistic Rosario-like selection regression (extended to the real planner)
A deterministic ~60-row catalog run through the **full real chain**:
`rankCandidatesByRelevance` → `selectBoundedWindow` →
`filterOverlappingExperienceCandidates` → `PlanningCandidateNormalizerService` →
`sortCandidatesDeterministically` → **`GreedyDailyPlanningSolver.solve`** (real
solver from `test/acceptance/harness/solver-factory`, deterministic fake travel).
Everything kept feasible so selection is the variable.

- the named "Monumento a la Bandera" standalone is facet-less → `preferenceScore
  0.2` (generic `visit` only) vs faceted history rows at `0.8` → ranks **59/60**,
  never in the 15-window, never in `plannerInputIds`, never in `selectedIds`;
- the only monument-carrying candidate that can reach the planner is the sprawling
  circuit (kept over a hypothetical better standalone by component count — CHAR-7);
- the hard preference tier holds every faceted history row above every sports row
  (`firstSportRank 44 > lastHistRank 21`); no sports row is windowed or scheduled;
  the facet-less monument shares the sports (pref ~0) tier;
- switching `iconic` → `local_deep_dive` leaves the window **and the scheduled
  set** unchanged (CHAR-2) — pinned as a `PRODUCT/DESIGN HYPOTHESIS`, not an
  invariant;
- the bitácora matched-themes signal is a JSON scan (CHAR-4);
- the full chain (through `solve`) is deterministic.

**Reclassified:** no `it.failing`. Two former RED "invariants" (named place in the
selection; `explorationStyle` must change selection) are green
`PRODUCT HYPOTHESIS` tests. The confirmed defects are RED in their own files.

### CHAR-11 (optional) — free-text transport integrity — NOT IMPLEMENTED
Deferred: `fe/components/tours/TourWizardForm.tsx` is under concurrent edit.
Counter-evidence that the frontend is not the defect: real tour
`e2b1a23d-833b-4f47-835c-d9ba50948e26` persisted `additionalPreferences:
"Monumento a la bandera"` into `tour.metadata`. Free-text transport works; every
defect above is downstream of it.

## DEFINITE ENGINE / IMPLEMENTATION DEFECTS

Confirmed by a RED test; each is a local implementation bug, not a design choice.

1. **Bitácora self-contaminates coverage (CHAR-4).** `matchedThemesFor` /
   `matchesThemeKeywords` scan a metadata object that includes the injected
   `preferenceEvaluation` (requested theme names as `facetMatches[].key`, even
   `matched:false`). Trace claims coverage a candidate explicitly failed.
2. **`mergeMetadata` is order-dependent (CHAR-8).** An incoming empty `[]`
   overwrites a populated `themes/traits/intents` array; canonical state depends
   on acquisition order.
3. **Coverage keyword matching is accent/diacritic-inconsistent (CHAR-3).**
   `matchesThemeKeywords` / `THEME_KEYWORDS` don't apply the diacritic-stripping
   `normalize()` used elsewhere; Spanish catalog names go uncounted.
4. **Quality contract mismatch (CHAR-6).** `PlanningCandidateNormalizerService`
   forwards the already-weighted `qualityBonus` (0..0.2) as `qualityScore`, and
   `scoreCandidateForDay` applies `qualityWeight` to it again — a second
   attenuation on a value not on the 0..5 scale the weight was tuned for. Plus:
   `qualityBonus` ignores `weightedScore` entirely for composites.
5. **Trait persistence flattens every free trait to `dimension:'general'`
   (CHAR-2 DB).** `resolveOrCreateTraitDefinitions` hardcodes `'general'`, so a
   trait token that belongs to a structured dimension (`tourism_intensity`,
   `local_character`) can never be matched as that dimension — and hence
   `exploration_style` can never match a trait-sourced Experience.
6. **Authoritative ranking priority is not carried past the normalizer (CHAR-5).**
   `PlanningExperienceCandidate` has no preference field;
   `sortCandidatesDeterministically` and `scoreCandidateForDay` are
   preference-blind. Demonstrated as an **ordering** inversion through the greedy
   sort and per-day soft score (strong-preference candidate ordered last); whether
   it also causes final candidate *loss* in a capacity-constrained plan is not
   asserted here and is left for the fix review to decide as a contract question.

## CONFIRMED ARCHITECTURAL GAPS

Factual observations, not necessarily bugs — pinned by green tests.

- Structured-provider facts (OSM tags, Places `primaryType`) are not projected
  into Experience `themes/traits` (CHAR-1, CHAR-1 DB).
- Places `rating` is never converted into `Experience.qualityScore` on the real
  acquisition path (CHAR-6 DB).
- `CoverageAnalysisInput` has no free-text / named-target field; a concrete
  "Quiero visitar X" cannot influence coverage or, by itself, acquisition
  (CHAR-9).
- `explorationStyle` has no acquisition-side producer of the dimensioned evidence
  its matcher requires (CHAR-2, CHAR-2 DB).

## OPEN PRODUCT / DESIGN DECISIONS

Not decided here; each is pinned as current behavior only.

- Whether structured OSM/Places evidence *should* deterministically derive
  `themes`.
- Exactly which provider facts (if any) justify `iconic` / `popular` / `local` /
  `hidden` — this pass explicitly removed the earlier unsupported inference
  "wikidata + wikipedia → iconic" and "absence → hidden/local".
- Whether a named place from free text is soft or required.
- Whether positive free text can trigger acquisition when generic coverage is
  already sufficient.
- Whether a composite should subsume a single-place Experience it contains.
- Whether overlap resolution should prefer component richness or user relevance
  (CHAR-7 `OPEN POLICY`).
- Whether the authoritative `preferenceScore` tier is *contractually* meant to
  survive into candidate selection / day placement, or only to order the offered
  window (CHAR-5).
- Which single preference-match definition becomes canonical.
- The final quality scale (raw 0..5 vs normalized 0..1) end to end.

## Unsupported assumptions removed in this pass

- `be/test/characterization/support/observations.ts`: `osmIconicPlaceObservation`
  / `osmHiddenLocalPlaceObservation` (which asserted, in name and description,
  that wikidata/wikipedia presence proves `iconic` and their absence proves
  `hidden`/`local`) replaced by neutral `structuredLandmarkAObservation` /
  `structuredPlaceBObservation` carrying only raw tags, plus an explicitly
  labelled `syntheticDimensionedExperience(dimension, key)` for matcher-only
  tests.
- CHAR-2 wording no longer claims any tag→facet factual equivalence.
- This report no longer lists "wikidata ⇒ iconic" or "absence ⇒ hidden" as facts.

## Root-cause groups (unchanged labels, tightened membership)

- **A — Semantic representation gap:** CHAR-1 (+DB), CHAR-2 (+DB), CHAR-6 (+DB).
- **B — Preference-semantics inconsistency:** CHAR-3, CHAR-4, and the
  matcher-vs-persistence split in CHAR-2.
- **C — Ranking / planner boundary inconsistency:** CHAR-5 (and its compounded
  effect visible in CHAR-10).
- **D — Catalog convergence / identity:** CHAR-7 (dedupe + overlap policy),
  CHAR-8 (merge order).
- **E — Specific user-intent satisfaction gap:** CHAR-9, CHAR-10 (product
  hypothesis).
- **F — Quality signal gap:** CHAR-6 (+DB).

## Minimum coherent fix surface (described, NOT implemented)

Ordered; `#1`+`#2` must land together (coverage would otherwise get stricter with
no backfill to compensate). `#6` is product-gated.

### 1. One preference-match primitive
- **Layers:** `theme-matching.util.ts`, `coverage-analyzer.service.ts`,
  `generation-trace-builder.util.ts`.
- **Change:** `CoverageAnalyzer` and `matchedThemesFor` delegate theme/trait/intent
  matching to a shared `experienceSatisfies(dimension, key)` that
  `candidateMatchesPreferenceFacet` also uses. Diagnostic blobs
  (`preferenceEvaluation`) are never part of the corpus.
- **Tests addressed:** CHAR-3, CHAR-4, and the consistency half of CHAR-1.
- **New abstraction:** one small shared matcher module (removes code paths).
- **Overfitting risk:** low. **DB migration:** none.

### 2. Structured-facet derivation stage (synthesis → persistence)
- **Layers:** new `deriveStructuredFacets(observation)` util invoked by the
  synthesizer (or a new enrichment service); `resolveOrCreateTraitDefinitions`
  stops hardcoding `'general'`.
- **Change:** deterministic mapping from a documented public-tag ontology
  (OSM/Places) to `themes[]` and, where the ontology genuinely supports it,
  `metadata.dimensionedTraits`. **Do not** re-introduce "wikidata ⇒ iconic".
- **Tests addressed:** CHAR-1 (+DB), CHAR-2 (+DB).
- **New abstraction:** yes — a reviewed tag→facet table.
- **Overfitting risk:** medium — mitigate by sourcing the table from the public
  ontology, not from fixture strings. **DB migration:** none.

### 3. Carry preference through the planner boundary
- **Layers:** `daily-planning.interface.ts` (`preferenceScore` on
  `PlanningExperienceCandidate`), `planning-candidate-normalizer.service.ts`,
  `candidate-window-selection.util.ts` (final sort key
  `(preferenceScore desc, totalScore desc)`), `daily-planning-candidate-sort.util.ts`,
  `daily-planning-placement.util.ts`, `daily-planning-policy.config.ts`.
- **Tests addressed:** CHAR-5, CHAR-10.
- **New abstraction:** none (one field + one weight/tier).
- **Overfitting risk:** low. **DB migration:** none.
- **Contract question to settle first:** tier vs weighted term; whether it applies
  only to window ordering or also to day placement.

### 4. Fix the quality contract
- **Layers:** `planning-candidate-normalizer.service.ts` (pass raw
  `experience.qualityScore`), `candidate-ranking.util.ts` (`qualityBonus` for
  composites), synthesizer + resolver (`VerifiedExperienceInput.qualityScore` from
  Places `rating` — ties to `#2`).
- **Change:** choose one scale (recommend raw 0..5 through the planner) and apply
  the weight exactly once.
- **Tests addressed:** CHAR-6 (+DB).
- **New abstraction:** none. **Overfitting risk:** low. **DB migration:** none
  (`Experience.qualityScore` exists).

### 5. Order-independent metadata merge
- **Layers:** `experience-catalog.service.ts` (`mergeMetadata`).
- **Change:** union array-valued keys; prefer non-empty scalars; never let an
  empty incoming array clear a populated one.
- **Tests addressed:** CHAR-8.
- **New abstraction:** small helper. **Overfitting risk:** low. **DB migration:**
  none (a one-time backfill of already-flattened rows is a separate optional task).

### 6. (PRODUCT-GATED) Represent a named / anchored request
- **Layers:** interpreter, coverage interface + analyzer, discovery planner,
  `selectBoundedWindow`.
- **Tests addressed:** CHAR-9, CHAR-10 product hypotheses.
- **New abstraction:** yes — a new intent dimension end to end.
- **Overfitting risk:** medium-high. **DB migration:** none.
- **Status:** DO NOT BUILD without product sign-off — contradicts the documented
  "positive preferences are always soft" invariant.

## Verification performed

- `yarn workspace backend test:characterization` (against `zigzag_test`) → 11
  suites / 58 tests pass; 7 `it.failing` defect tests are RED as designed.
- DB safety proof: `zigzag` → refused before TRUNCATE; `zigzag_test` → passes.
- `yarn workspace backend typecheck` → clean.
- `eslint test/characterization/**` → clean.
- Regex isolation confirmed via `jest --listTests` for every config (see above).
- No production file changed → default `yarn test` / `test:e2e` / `test:integration`
  / `test:acceptance` behavior is unaffected by construction.

## Not done / out of scope

- No production semantic change, no schema change, no fix implemented.
- CHAR-11 (frontend transport spec) deferred.
- Phase 7 / Checkpoint G status unchanged.
