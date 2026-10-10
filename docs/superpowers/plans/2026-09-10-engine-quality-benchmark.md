# Phase 7 Checkpoint G — engine-quality benchmark

Status: **implemented & green.** Branch `feat/experience-domain-v2`. Written 2026-09-10.
Starting HEAD `9e27c12910c10935138a00aee25bb01b6c43b628`.

> G answers: *given a rich, verified catalog, does the deterministic selection/planning
> engine choose good Experiences for this user, and do small preference changes produce
> sensible directional changes?* It does **not** answer whether acquisition can *discover*
> Experiences from an empty database — that is cold-start characterization
> (`be/test/live/cold-start-experience-acquisition.live-spec.ts`,
> `docs/superpowers/characterization/2026-09-09-buenos-aires-cold-start-discovery-characterization.md`).

## 1. Existing coverage — what `experience-selection-scale.e2e-spec.ts` already proves

Real `AppModule` + real Postgres/pgvector + `POST /tours/generate-tour` + real outbox +
real coverage/ranking/normalizer/solver/feasibility/materialization/trace; fakes only
`LangChainService` (preference interpreter), `AiEmbeddingService` (binary
positive/negative vectors), `GeoapifyTravelEstimateProvider` (Haversine). 6 scenarios, each
with a **fresh per-scenario 320-row catalog** tuned so exactly one `oracleClass` is valid,
asserted by exact id/class membership: culture+art+tango w/ religion exclusion,
vegan+budget+duration feasibility, reduced-mobility+opening-hours, mixed-age family,
long-tail intent, deterministic hard-exclusion relaxation. Plus one counterfactual that
**rewrites `experience.embedding` via SQL between profiles**. It proves feasibility
handling, exclusion, and preference→selection direction *when the catalog is built for the
answer*.

## 2. The gap

A per-scenario custom catalog does not prove **discrimination among credible competitors**.
The interesting case is 30–80 plausible candidates where ranking must choose. G reuses **one
shared heterogeneous corpus, unchanged**, across several profiles, and asserts that a
one-dimension preference change moves the selection in the right direction — over the *same*
persisted rows and the *same* persisted embeddings.

## 3. Shared competitive corpus

`be/test/support/experience-selection/corpus.ts` — 320 rows, 15 clusters, seeded once, never
mutated. Stable ids `comp-<clusterKey>-<NNN>`. Origin Obelisco; signal+filler rows (234)
within ~150 m, distractors (86) 280–600 m out so the `findVerifiedWithin(…,250)` cut keeps
all signal. All `VERIFIED`, `ENRICHED`, `openingHours` always-open, durations 60–120 min —
feasibility is deliberately *not* the binding constraint (that is the scale spec's job).

| cluster | rows | themes | traits | dimensionedTraits | q |
| --- | --- | --- | --- | --- | --- |
| iconic_history_arch | 16 | history, architecture | guided_tour | tourism_intensity:iconic | 4.4 |
| hidden_history_arch | 16 | history, architecture | local, offbeat | tourism_intensity:hidden + local_character:authentic | 4.2 |
| craft_beer_crawl | 16 | food | local, craft_beer | local_character:authentic | 4.2 |
| specialty_coffee_tour | 16 | food | local, specialty_coffee | local_character:authentic | 4.2 |
| generic_food_walk | 16 | food | local | — | 4.0 |
| exact_fit_history | 16 | history, architecture | local_guide | — | 4.3 |
| generic_five_star_history | 16 | history | — | — | **5.0** |
| secular_history_arch | 20 | history, architecture | guided_tour | — | 4.1 |
| religious_history_arch | 20 | history, architecture, **religion** | religious | — | 4.9 (name/desc carry `catedral`/`iglesia`) |
| history_tango | 16 | history, architecture, tango | performance | — | 4.2 |
| history_plain | 16 | history, architecture | — | — | 4.6 |
| culture_misc | 30 | history, culture, art | — | — | 3.6 |
| food_misc | 20 | food, gastronomy | — | — | 3.5 |
| distractor_shopping / distractor_sports | 43 + 43 | shopping / sports | — | — | 3.0 (NULL embedding) |

`metadata.dimensionedTraits` is **read by production** (`hasExplicitDimensionedEvidence`) and
is the only way `tourism_intensity` / `exploration_style` matching sees a row.
`metadata.oracle` (`{cluster, axisWeights, iconicity, localness, preferenceTags,
qualityScore, feasible, geoOk, …}`) is **read by no production code** (grep-clean) — test
scaffolding for assertions and the dominance helper. Rule: only
`religious_history_arch` puts a `religion` alias token in free text.

**Catalog identity:** `snapshot.ts` fingerprints every non-embedding column (sha256) + a
separate `embedding::text` hash; `reverifyCorpus` runs in `afterEach` of every scenario and
in `afterAll`. Any row/embedding mutation between profiles fails the guard — structurally
forbidding the scale spec's SQL-embedding-rewrite trick.

## 4. Deterministic multi-axis semantic oracle

`be/test/support/experience-selection/axis-oracle.ts`. 16 axes; each owns a disjoint 16-dim
band filled with a constant weight, then L2-normalized, so the ×16 band factor cancels:

```
cosine(projectAxisVector(P), projectAxisVector(Q)) === cosine(P, Q)   (raw axis-weight cosine)
```

pgvector's `1 - (a <=> b)` computes exactly this, so DB ordering == in-test ordering.
`queryToAxisWeights` parses the real `buildSemanticTourQuery` output (`Interests:` /
`Exploration style:` / `Additional preferences:` lines) into axis weights. The fake
`AiEmbeddingService.embedQuery(q) = projectAxisVector(queryToAxisWeights(q))`; stored row
vectors are written once by the seeder from `oracle.axisWeights` with a fixed
`INDEX_IDENTITY`. **Critical invariant:** a different profile → a different query string → a
different query vector, while stored vectors are never rewritten (asserted:
`snap.embeddingHash` constant across the whole run; `embedQuery(qA) ≠ embedQuery(qB)`).

Observed directional cosine deltas (property block, real functions):
CF1 iconic-query vs {iconic row} − vs {hidden row} ≈ **+0.42**, mirrored for the local
query; CF2 craft-beer-query vs {beer row} − vs {coffee row} ≈ **+0.40**, mirrored.

## 5. Counterfactuals (`profiles.ts` + `experience-selection-competitive.e2e-spec.ts`)

Base request = scale-spec shape, `radiusMeters 3000`, `days 1`. Every variant passes a
non-empty `additionalPreferences` (else `PreferenceInterpreterService` short-circuits and the
fake interpreter is never called); the service then overwrites it with
`positiveSemanticQuery`.

| CF | delta | expected direction |
| --- | --- | --- |
| **CF1 iconic vs local deep dive** | only `explorationStyle` + query | A → 100% `iconic_history_arch`; B → 100% `hidden_history_arch`; pools disjoint; plans differ |
| **CF2 craft beer vs specialty coffee** | only the added trait facet + query | A → 100% `craft_beer_crawl`; B → 100% `specialty_coffee_tour`; shares move directionally; plans differ |
| **CF3 exact fit vs generic 5-star** | single profile | exact_fit (q 4.3, 4/4 facets) sweeps; `generic_five_star_history` (q 5.0, 1/4) not even offered; every selected q ∈ [4.2, 4.4] |
| **CF4 hard exclusion (religion)** | single profile, `hardExclusions:['religion']` | 0 religion rows selected or pooled; coverage still `none` |
| **CF5 one-preference delta** | add `tango` interest only | itinerary flips to `history_tango`; baseline has 0; plans differ |

Why the direction holds: `preferenceScore` is a **hard sort tier** (`preferenceCompare`,
`candidate-ranking.util.ts`), and each wizard `preferredFacet` contributes
`importance·confidence = 1.0` to `positiveRatio = matched/possible`. A one-facet change moves
the target cluster from `3/4 → 4/4` (or `2/3 → 3/3`), a strict tier that quality/semantic
cannot cross; and a sufficiently-populated top tier fills the 15-slot window (no
cluster/family cap) and the whole itinerary.

## 6. Evaluation dimensions (kept independently observable — no magic score)

preference fit · hard constraints · feasibility · geographic coherence · intrinsic quality
(bonus, not substitute) · counterfactual sensitivity · dominance/regret · diversity
(diagnostic). Each is a distinct assertion or a distinct diagnostic; none is combined into a
persisted production score.

## 7. Strict dominance / regret

`findStrictlyDominatedSelections(requestedFacetKeys, selected, feasibleNonSelected,
oracleById)` (`assertions.ts`). A selected row S is dominated by a feasible non-selected row
C iff, over the profile's requested facet keys, C's satisfied set ⊇ S's, strictly larger on
≥1, and `C.qualityScore ≥ S.qualityScore − 0.5`. Uses only `oracle.preferenceTags` (==
what `candidateMatchesPreferenceFacet` returns true for) and `qualityScore`;
`iconicity`/`localness` are never used as ordinal "better". Asserted `=== []` for every CF.

## 8. Non-goals

No global quality model / recommendation score / diversity engine / ontology / DB schema /
LLM in ranking-planning / OSRM / acquisition change / cold-start-quality work / agentic
convergence / curation. The scale spec is not restructured. `test:integration`'s
`test-db.ts` is untouched (its guard is the DB-hardening plan's increment D).

## 9. Acceptance criteria — all met (see §11)

1. scale e2e still green · 2. shared ~320-row corpus seeded once · 3. ≥2 profiles on the
same persisted catalog · 4. iconic-vs-local · 5. craft-beer-vs-coffee · 6. one-preference
delta · 7. hard exclusion under pressure · 8. quality ≠ substitute for fit · 9. strict
dominance `=== []` · 10. deterministic on repeat · 11. no discovery/acquisition · 12. real
Postgres · 13. real ranking/planner/materialization · 14. catalog unchanged between
profiles (`reverifyCorpus`) · 15. existing suites intact · 16. no new global quality
architecture · 17. CI green / pre-existing failures identified.

## 10. Verification commands

```
yarn workspace backend prisma:generate
yarn workspace backend typecheck
yarn workspace backend lint:check
yarn workspace backend test --runInBand
yarn workspace backend test:acceptance
yarn workspace backend test:integration     # ALLOW_DESTRUCTIVE_TEST_DB=1 or a *_test DB
yarn workspace backend test:e2e --runInBand  # DATABASE_URL → a disposable DB
yarn workspace backend build
```

## 11. Production-change policy & results

Run against current code. **A** = passes (engine already good) · **B** = clear local bug,
smallest fix + regression assertion · **C** = ambiguous product quality → document & stop,
do **not** invent a scoring architecture.

### Checkpoint G results — 2026-09-10

Ending HEAD: see the progress doc. Local run vs the `zigzag_test` database (pgvector pg15).

- **`yarn test:e2e --runInBand`: 4 suites / 40 tests green** — `app.e2e-spec.ts` (1),
  `experience-selection-scale.e2e-spec.ts` (7, unchanged behavior; only the guard call
  added), `support/assert-disposable-database.e2e-spec.ts` (15),
  `experience-selection-competitive.e2e-spec.ts` (17).
- `yarn typecheck` 0 · `yarn build` clean · `yarn test --runInBand` 125 suites / 1001
  tests · `yarn test:acceptance` 20 / 30 · `yarn test:integration` 11 / 16 · scoped
  `eslint` on the new files clean.

| Scenario | Outcome | Evidence |
| --- | --- | --- |
| Axis-oracle properties | **A** | query vectors diverge directionally by ≈0.42 (CF1) / ≈0.40 (CF2) cosine; `snap.embeddingHash` byte-stable across the run |
| Facet-primitive pre-check (CF1) | **A** | `candidateMatchesPreferenceFacet` discriminates iconic vs local dimensioned evidence in both directions |
| CF1 iconic vs local deep dive | **A** | 1A → 7/7 `iconic_history_arch`; 1B → 7/7 `hidden_history_arch`; candidate pools disjoint; `plan(1A) ≠ plan(1B)`; deterministic on repeat |
| CF2 craft beer vs specialty coffee | **A** | 2A → 5/5 `craft_beer_crawl`; 2B → 7/7 `specialty_coffee_tour`; shares move directionally; plans differ; deterministic |
| CF3 exact fit vs generic 5-star | **A** | 7/7 `exact_fit_history`; `generic_five_star_history` never offered; every selected q ∈ [4.3]; the q-5.0 cluster is trapped one preference tier below and does not compete — confirms the documented "preference is a relevance tier, not a bonus quality may override" invariant |
| CF4 hard exclusion (religion) | **A** | 0 religion rows selected or in the candidate pool; coverage `none`; deterministic |
| CF5 one-preference delta (+tango) | **A** | 5A → 7/7 `history_tango`; 5B → 0 `history_tango`; `plan(5A) ≠ plan(5B)`; a single added `theme:tango` facet moves the whole itinerary |
| Strict dominance / regret | **A** | `findStrictlyDominatedSelections === []` for every scenario |
| Determinism | **A** | every profile generated twice → deep-equal `plan()` |
| No discovery / acquisition | **A** | every tour: `coverage.decision.action === 'none'`, no `discovery` / `entity_resolution` / `geographic_validation` / `catalog_materialization` step |
| Catalog identity | **A** | `reverifyCorpus` (full row hash + embedding hash) passes in every `afterEach` and `afterAll` — the corpus and its embeddings are byte-identical across all 12 generations |

**No production code was changed for G.** No Outcome B, no Outcome C.

### Finding CP-G-DIV-1 — set-level diversity is unimplemented (finding, not a bug)

Diversity is **measured, never asserted**. Every G itinerary collapses to a **single
cluster** (`maxSingleClusterShare = 1.0`, `distinctClusters = 1`, `distinctThemes` 1–2):
once one preference tier is populated by ≥16 rows it monopolizes the 15-slot window
(`selectBoundedWindow` has no per-cluster/family cap — `MAX_VARIANTS_PER_FAMILY` no longer
exists) and the solver's soft score (`scoreCandidateForDay`) has no redundancy term. The
weak `diversityBonusFor` in `candidate-ranking.util.ts` is subordinate to the preference
tier and to `baseScore`, and only in the semantic-`applied` tier.

This is **consistent with the current product spec** — interest chips are pure-soft, no
set-level diversity requirement is documented, and `docs/architecture/...` describes the
*intended* "marginal non-redundancy within the selected set" as not-yet-built. So it is a
**finding, not a bug**; **no production change in this checkpoint**.

Recommended follow-up (separate, reviewed): a small deterministic soft redundancy penalty in
`scoreCandidateForDay` or a per-normalized-subtype cap in `selectBoundedWindow`, with its
own regression assertion in this benchmark.

## 12. Adjacent: test-DB safety

`be/test/support/assert-disposable-database.ts` — a minimal fail-closed guard shared by the
scale e2e and the G benchmark: refuses to `TRUNCATE` unless the DB name ends in
`_test`/`-test`/`_integration`/`_e2e`/`_ci`, or `ALLOW_DESTRUCTIVE_TEST_DB=1` is set (the CI
opt-in — `e2e-deterministic`'s postgres service is ephemeral but named `zigzag`). This is
**not** the full test-DB hardening
(`docs/superpowers/plans/2026-09-09-database-pool-hardening-and-observability.md` §15-16
still owns increment D); `be/test/integration/support/test-db.ts` is deliberately untouched.

## 13. Related documents

- `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md`
- `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md`
- `docs/architecture/activity-discovery-and-tour-generation.md`
- `docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`
- `docs/superpowers/specs/2026-09-06-tour-materialization-exposure-design.md`
- `docs/superpowers/plans/2026-09-09-database-pool-hardening-and-observability.md`
