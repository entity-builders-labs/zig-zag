# RW4 FINAL COLD + WARM rerun after the walking-ordering fix — 2026-10-08

Track `preference-first-selection`, branch `feat/preference-first-selection`.
HEAD `27315cf744c2f2554d4c44c3759657572002b76f` ("fix(tours): enforce walking
constraints during day ordering"). Not merged.

## 0. Lineage

```text
previous final COLD (d102fbc0, zigzag_spike_rw4_final)
  → COLD_NOT_QUALIFIED: validator MAX_CONTINUOUS_WALKING_EXCEEDED
    (spikes/rw4-final-cold-warm-validation-2026-10-08/README.md)
→ forensic root cause: placement checked walking on its own order; routed
  day ordering created a new 3,336 m leg without reapplying walking limits
  (RW4-FINAL-PLAN-INFEASIBLE-1; dossier §9 correction)
→ fix 27315cf7: one walking-feasibility authority for placement and ordering
→ this rerun: fresh DB, same request/providers/harness, COLD then WARM
```

Raw artifacts stay in the campaign directory
`spikes/rw4-functional-composite-campaign-2026-10-05/` as
`rw4-final-rerun-cold/` and `rw4-final-rerun-warm/` (logs are gitignored;
anomalies extracted to `analysis/provider-anomalies.txt`). Projections for
this dossier live under `analysis/`. The prior dossier is not modified.

## 1. Execution identity

| Field | COLD | WARM |
|---|---|---|
| HEAD / `runtime.buildCommit` | `27315cf7…` / equal | `27315cf7…` / equal |
| Provenance | `canonical: true`, no failures | `canonical: true`, no failures |
| Database | `zigzag_spike_rw4_final_rerun` (new; dropped/created/migrated) | same DB, reused (no reset) |
| Run label | `rw4-composite-rw4-final-rerun-cold` | `rw4-composite-rw4-final-rerun-warm` |
| Tour id | `85ebc2c6-5091-46b7-943c-7b7565ec7829` | `7e6a203a-ccd8-44bf-a52a-33a6877a132a` |
| Request | `requests/c3-buenos-aires-san-telmo-self-guided.json` | same |
| Start → end (UTC) | 22:59:21 → 23:08:56 (575 s) | 23:14:44 → 23:18:57 (253 s) |
| Generation status | `completed` (4 Experiences) | `completed` (4 Experiences) |

Command (both, `reuse` for WARM):
`DISCOVERY_EXTRACTOR_PROVIDER=gemini bash run.sh rw4-final-rerun-cold
zigzag_spike_rw4_final_rerun fresh 3420 requests/c3-…json tavily`.

Providers (`provider-preflight.json`, identical COLD/WARM): grounded search
`serper`; discovery extractor and classification `gemini`
`gemini-3.5-flash-lite`; web content `tavily`; places/routing `geoapify`;
local Nominatim (8088) / Overpass (12345); preference interpretation `groq`
`qwen/qwen3.8-27b`; embeddings local `ollama` `nomic-embed-text`.

## 2. COLD verdict — COLD_QUALIFIED

1. Canonical live path executed (HTTP → outbox → generation), provenance
   verified.
2. Final planning read a fresh post-acquisition snapshot (§3).
3. The solver output passed `TourPlanningFeasibilityValidatorService`: the
   validator runs before `planning.daily` is recorded
   (`experience-generation.service.ts:1535`), and `planning.daily`
   (`DAILY_PLAN_BUILT`) and `tour.materialization`
   (`TOUR_EXPERIENCES_PERSISTED`) are both present.
4. Tour materially persisted: 4 `tour_experience` rows, 10
   `tour_experience_component` rows.
5. No source-member fabrication or loss (§5 integrity).
6. No new architectural regression found (§10 lists known debt only).
7. Provider degradation (one Gemini 429, three Wikidata timeouts) did not
   make the result uninterpretable (§9).

## 3. Gather → Reconcile → Freeze → Plan (COLD)

`analysis/cold-chronology.json`:

```text
catalog.snapshot      INITIAL                                 epoch 0  (step 5, 0 eligible)
generation.gather     GATHER_START                                     (step 8)
planning.provisional  PROVISIONAL_PLAN_DISCARDED_FOR_REFILL   epoch 4  (step 112, residual 141 min)
generation.gather     GATHER_COMPLETE                         epoch 5  (step 145)
catalog.snapshot      FINAL                                   epoch 5  (step 146, 19 eligible, 2 composites)
candidate_pool.selection / ranking.semantic                            (steps 147–148)
planning.daily        DAILY_PLAN_BUILT (4 selected, 0 unselected)       (step 149)
selection.final       POST_RECONCILIATION_SELECTION           epoch 5  (step 150)
tour.completeness     TOUR_COMPLETE                                    (step 151)
tour.materialization  TOUR_EXPERIENCES_PERSISTED                       (step 152)
```

- Five acquisition executions: pass 1 AREA_ROUTE_WALK, pass 1 GENERIC,
  pass 2 AREA_ROUTE_WALK, pass 2 GENERIC, pass 1 PLANNER_CAPACITY.
  Materialized: NEW 19, SAME 11, AMBIGUOUS 0, REJECTED 24, ENRICHED 0.
- **`finalCatalogReadEpoch (5) >= lastAcquisitionEpoch (5)`**.
- The final Tour is not the provisional plan: provisional planned
  `ad174cd8, 137ce001, 0d9451a1, 3f9434cb, a377c19b`; final planned
  `0613fabb, ad174cd8, 137ce001, a377c19b`.
- **Late-acquired knowledge changed the final selection.** `0613fabb` (the
  secretsofbuenosaires "Day 1" walk) was persisted by the final
  PLANNER_CAPACITY execution, after the provisional plan, and is the
  first stop of the final Tour. The previous final COLD could not
  demonstrate this scenario.

## 4. Walking-fix live proof

Final day 1 order (COLD; WARM identical, §8). Legs are the persisted
`tour_experience.travelFromPrevious` (`analysis/cold-tour-walking.txt`),
all Geoapify, `approximate: false`; planner routing
`fallbackCount 0`, `approximateEstimateCount 0`.

| # | Experience | Inbound walking leg | Running external | + internal |
|---|---|---|---|---|
| 1 | `0613fabb` Walking tour Buenos Aires – Day 1 (part 1 of 2) | — | 0 m | 3,296 m |
| 2 | `ad174cd8` Museo Histórico Nacional | 210 m | 210 m | 3,506 m |
| 3 | `137ce001` Roca granitica | 799 m | 1,009 m | 4,305 m |
| 4 | `a377c19b` Manzana de las Luces | 2,724 m | 3,733 m | **7,029 m** |

- Largest continuous leg: **2,724 m** external; internal max 1,363 m.
  Limit `maxContinuousWalkingDistanceMeters` = **3,000 m**.
- Day total **7,029 m** (3,733 m external + 3,296 m internal). Limit
  `maxWalkingDistancePerDayMeters` = **10,000 m**.
- Internal walking of `0613fabb`: 6 consecutive component legs of 252,
  315, 1,363, 317, 176 and 873 m (`analysis/cold-internal-walking-replay.json`).
  The solver computes but does not persist these values. They come from a
  read-only replay with the production normalizer and the
  Resilient(Geoapify) provider. Its `internalWalkingMinutes` (51.0843) equals
  the live trace exactly: `totalExperienceMinutes` 411.0843 = 4 × 90 +
  51.0843.
- Repair actions: none in the final solve (`planning.daily`
  `unselectedCount 0`). The promotion-loop trial solves are not traced
  individually.
- Validator: passed.
- **Did the previous unchecked-leg defect reproduce? NO.** No emitted leg
  exceeded 3,000 m and the validator found no walking violation. This run
  does not by itself exercise a skip or repair. The skip/repair path is
  proven by the unit and solver→validator tests in `27315cf7`.

## 5. Catalog / composite state (after WARM)

`analysis/cold-db-evidence.txt`, `analysis/warm-db-evidence.txt`.

| Experience | Source | Members | Resolved | Unresolved | Distinct geo | Completeness | Dedupe / relation / source | Selected |
|---|---|---|---|---|---|---|---|---|
| `0613fabb` Walking tour Buenos Aires – Day 1 (part 1 of 2) | secretsofbuenosaires.com day-1 walk | 18 | 7 | 11 | 7 | PARTIAL | NEW / PARTIAL_OVERLAP / DIFFERENT_SOURCE (shares Mercado de San Telmo with `3f9434cb`) | COLD + WARM, position 1 |
| `3f9434cb` "Frequently Asked Questions" | argentina4u.com San Telmo walking tour | 6 | 2 | 4 | 2 | PARTIAL | NEW / SUBCOMPOSITION / SOURCE_UNKNOWN | no (provisional only) |
| `5ff30e31` San Telmo Evening and Park Walk (WARM) | turismo.buenosaires.gob.ar "An evening in San Telmo" | 3 | 2 | 1 | 2 | PARTIAL | NEW / PARTIAL_OVERLAP / DIFFERENT_SOURCE | no: `OVERLAP_EXCLUDED` (REDUNDANT_WITH `0613fabb`) |

Unresolved members keep `sourcePosition`, `sourceName`, `resolutionReason`
and `resolutionSource` (NULL). Full tables are in the evidence files. The
11 unresolved members of `0613fabb`:
- `AMBIGUOUS_CANDIDATES`: PLAZA DE MAYO, Casa Rosada, Feria San Telmo,
  Club Atlético.
- `CANDIDATE_UNCONFIRMED`: Museo del Cabildo, Museum of Modern Arts,
  national history museum.
- `CANDIDATE_REJECTED`: Mausoleum of General San Martín.
- `NO_CANDIDATE_ACQUIRED`: "oldest neighborhood of the capital city",
  "big building with columns", "walkway".

Integrity (COLD and after WARM): `unresolved_with_geo = 0`,
`resolved_without_geo = 0`, `without_source_position = 0`,
`without_source_name = 0`.

Quality observations (known debt classes, not regressions):
- `3f9434cb` was persisted under the page heading "Frequently Asked
  Questions". It lists Casa Mínima twice (pos 1 RESOLVED, pos 4 "Casa
  Mínima (Miniature House)" UNRESOLVED): extraction quality.
- The agusyornet San Telmo walk (persisted 13/4 in the previous final COLD)
  was `CONTRACT_FAIL_CLOSED` in AREA_ROUTE_WALK pass 1 and `INVALID_RUN`
  in pass 2 here (RW4-EXTRACT-STABILITY-1 class).
- **"National Bank" → `Edificio First National Bank of Boston`**
  (`osm:relation:9254658`, hint in `verifiedHintNames`) is a RESOLVED member
  of `0613fabb` and appears in both Tour snapshots. This is the known
  **RW4-ID-FALSE-VERIFY-2** (OPEN, HIGH, BLOCKED on an owner decision,
  RW4-ID-SOURCE-GROUNDING-1) reproducing live. It is not new. No admin
  revoke/confirm was used.

## 6. Structural dedupe

COLD materialization audits: EXACT_COMPOSITION 11 (all SAME,
`reconciliation=NO_NEW_KNOWLEDGE`, `SAME_SOURCE_OBSERVATION`), DISJOINT 17,
SUBCOMPOSITION 1, PARTIAL_OVERLAP 1. Source relation: SOURCE_UNKNOWN 29,
DIFFERENT_SOURCE 1. AMBIGUOUS dedupe 0. WARM: SAME/EXACT_COMPOSITION 4,
NEW/PARTIAL_OVERLAP/DIFFERENT_SOURCE 1.

The only `0.58…` value in either trace is a ranking `semanticSimilarity`
(0.5811, `candidate_pool.selection` and `selection.final`). It is never a
dedupe decision. The old `semanticSimilarity >= 0.58 → AMBIGUOUS` authority
did not resurface. The progress entry RW4-DEDUPE-SEMANTIC-1 still reads
OPEN: documentation debt only.

## 7. Duration

All 19 COLD Experiences have `durationMinutes = NULL`. The 4 selected
Experiences are **PLANNING_FALLBACK** at 90 minutes
(`DailyPlanningPolicy.compositeDefaultDurationMinutes`, single authority
`planning-candidate-normalizer.service.ts:65`; replay
`plannerDurationMinutes 90`). The composite's `tour_experience.duration`
of 2.3514 h is 90 + 51.08 internal travel minutes. None of the 4 selected
Experiences has a FACTUAL_DURATION.

WARM's new `5ff30e31` was persisted with `durationMinutes = 120`. That value
comes from the Gemini extractor's `suggestedDurationMinutes`, not from a
backend unknown-duration fallback. No backend path assigns 120 to unknown
duration (`grep` over `be/src/modules/tours`). The trace does not record a
duration-source fact for it (future duration-knowledge spec). It was not
selected.

## 8. WARM — knowledge reuse

| | COLD | WARM |
|---|---|---|
| Initial snapshot | 0 eligible | 19 eligible; coverage `SUFFICIENT` |
| Acquisition executions | 5 (AREA_ROUTE_WALK ×2, GENERIC ×2, PLANNER_CAPACITY) | 1 (PLANNER_CAPACITY) |
| Materialized | NEW 19, SAME 11, REJ 24 | NEW 1, SAME 4, REJ 6 |
| Classification | all new | 4 REUSED, 1 CLASSIFIED (the NEW one) |
| Provider requests | 856 | 580 |
| — excluding Geoapify routing | 349 | 40 |
| Gemini / Serper / Tavily | 82 / 4 / 4 | 3 / 1 / 0 |
| Wikidata / Nominatim / Overpass | 85 / 30 / 13 | 9 / 4 / 6 |
| Geoapify routing | 507 | 540 |
| Final Tour | `0613fabb, ad174cd8, 137ce001, a377c19b` | identical order |
| Walking legs / day totals | 210 / 799 / 2,724 m; 111.17 walking min | identical |
| Snapshot components | 7 / 1 / 1 / 1 | 7 / 1 / 1 / 1 |

Reacquisition classification:
- **PLANNER_CAPACITY refill: intentional knowledge deficit.** The
  catalog-only provisional plan already equals COLD's final Tour, but it
  leaves 188.8 residual minutes with the reservoir exhausted. The refill
  policy authorizes one capacity acquisition. COLD ended in the same state
  (`RESERVOIR_EXHAUSTED`).
- The 4 SAME candidates were re-observed and reconciled with
  `NO_NEW_KNOWLEDGE`. Identity resolution ran again for the refill pass's
  candidates (`resolution.entity`: 5 accepted, 6 rejected), at a fraction
  of COLD's lookup volume (Wikidata 9 vs 85, Nominatim 4 vs 30).
- The 6 rejected candidates (Galería Güemes, Iglesia San Ignacio de Loyola,
  Bar El Federal, Pasaje San Lorenzo, El Zanjón de Granados: `UNCONFIRMED_MATCH`;
  Centro Científico: `NO_OSM_MATCH`) were re-resolved. **Missing catalog
  knowledge by design:** rejections are not persisted.
- `5ff30e31` NEW: a new web observation (external) from a grounded search
  on a different result. It was correctly excluded as redundant with
  `0613fabb`.
- Geoapify routing (540 vs 507) is planner work, not acquisition: the
  promotion loop re-routes per trial solve and no routing cache spans
  runs. This is efficiency debt, not a knowledge-reuse failure.

Deterministic stability: identity decisions for every reused member, the
structural composition of all persisted composites, the selected
portfolio, the order, the walking legs, the durations and the planner
feasibility are identical between COLD and WARM. Ranking inputs differ
slightly: semantic similarity for the same Experiences, e.g. `0613fabb`
0.625 → 0.608. The Groq preference interpretation returned different
raw text in each run (evidence spans, one confidence 0.95 vs 0.9, facet
order). The accepted facets are identical (`walk`, `history`;
`self_guided` rejected `UNKNOWN_KEY`). The shift is consistent with that
external LLM variance and did not change the selection.

## 9. Provider / runtime anomalies

`analysis/provider-anomalies.txt`:

| Class | COLD | WARM |
|---|---|---|
| 429 | 1 × Gemini (15 RPM) during pass-2 GENERIC extraction (agusyornet window 2/5 → `FAILED`); trace `acquisitionProvidersFailed: ["web"]` | 0 |
| Timeout | 3 × Wikidata proximity (10 s) | 0 |
| Provider fallback | 0 (planner `fallbackCount 0`) | 0 |
| Routing degradation | 0 approximate estimates | 0 |
| Extraction failure | the 429 above; plus extractor-contract outcomes (`CONTRACT_FAIL_CLOSED`, `INVALID_RUN`) on atomized units: product/extraction-stability class, not provider | none observed |
| Classification failure | 0 | 0 |

## 10. Remaining debt

| Item | State after this run |
|---|---|
| RW4-ATOM-SCOPE-1 | OPEN, unchanged (not exercised specifically) |
| RW4-EXTRACT-STABILITY-1 | OPEN; reobserved: agusyornet unit fail-closed this run vs 13/4 in the previous COLD; FAQ-heading composite name |
| RW4-RECONCILE-GEO-1 | OPEN, LOW, unchanged (0 ENRICHED this run) |
| RW4-WALKING-VALIDATOR-SEMANTICS-1 | OPEN, LOW; caused no failure |
| Frontend unknown-duration `90` display | OPEN, unchanged |
| PF-CI-FLAKE-1 | OPEN; not proven resolved |
| CHAR-7 | pre-existing characterization failure, unchanged |
| RW4-ID-FALSE-VERIFY-2 | OPEN, HIGH; National Bank false mapping reproduced and selected |
| RW4-FINAL-PLAN-INFEASIBLE-1 | **CLOSED** by this live rerun |
| Docs: RW4-DEDUPE-SEMANTIC-1 wording | stale (documentation debt) |

## 11. Verdict

- COLD: **COLD_QUALIFIED**. WARM: run; knowledge reuse proven (catalog
  reuse, identical Tour, 4 classifications reused, non-routing provider
  requests 349 → 40).
- **RW4_FUNCTIONAL_PASS_WITH_NONBLOCKING_QUALITY_DEBT**. It is not a
  clean pass because the selected composite carries the known HIGH false
  identity (National Bank) and extraction stability is still variable.
