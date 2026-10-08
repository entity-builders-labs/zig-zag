# RW4 FINAL COLD + conditional WARM validation — 2026-10-08

Track `preference-first-selection`, branch `feat/preference-first-selection`.
HEAD `d102fbc083b8ec984222abe8529183c4f4b960c5` ("test(tours): pin catalog
duration projection for findById"). Not merged.

This dossier records the **final canonical COLD** run for the
GATHER → RECONCILE → FREEZE → PLAN implementation, and the reason **WARM was
not run**. Raw artifacts stay in the campaign directory
`spikes/rw4-functional-composite-campaign-2026-10-05/rw4-final-cold/`; the
analysis projections produced for this dossier live under `analysis/`.

## 1. Execution identity

| Field | Value |
|---|---|
| HEAD | `d102fbc083b8ec984222abe8529183c4f4b960c5` |
| Branch | `feat/preference-first-selection` |
| Integration target | `main` |
| Database (COLD) | `zigzag_spike_rw4_final` (fresh; dropped/created/migrated) |
| COLD run id | `rw4-final-cold` (runner label `rw4-composite-rw4-final-cold`) |
| Tour id | `4d10c9f9-3faf-4922-97e6-579c3c2e51f7` |
| Request | `requests/c3-buenos-aires-san-telmo-self-guided.json` (history + architecture, `intent:walk`, `enjoys_walking` 10000/3000) |
| Start / finish | 2026-10-08T14:39:03.934Z → 2026-10-08T14:48:47.833Z (~584 s) |
| Provenance | canonical (`provenance.json` `canonical:true`, trace `runtime.buildCommit` == HEAD) |

### Providers / models (canonical, `provider-preflight.json`)

| Role | Value |
|---|---|
| Grounded search | `serper` |
| Discovery extractor | `gemini` `gemini-3.5-flash-lite` |
| Web source content | `tavily` |
| Classification | `gemini` `gemini-3.5-flash-lite` |
| Places / routing | `geoapify` |
| Geocoding / OSM | local `nominatim` (8088) / `overpass` (12345) |

Provider request totals (845): geoapify routing 505, wikidata 90, gemini 64,
geoapify place-details 39, nominatim 33, ollama 32, geoapify geocode 28,
wikipedia 24, overpass 14, wikivoyage 6, serper 4, tavily 3, geoapify places
2, groq 1.

## 2. COLD verdict

**COLD_NOT_QUALIFIED** (WARM not run).

The run reached the canonical live generation path, executed the full
GATHER → RECONCILE → FREEZE → PLAN sequence, and persisted a canonical
PARTIAL composite. The **final plan then failed** at the feasibility validator
before any `TourExperience` was materialized:

```text
Deterministic daily planning produced an infeasible solution:
MAX_CONTINUOUS_WALKING_EXCEEDED: Day 1: the leg into Experience
32656b95-d509-4e0d-afca-af00680b2dd8 exceeds the continuous walking limit.
```

## 3. Persisted canonical Experiences

18 Experiences persisted COLD; **every one has `durationMinutes = NULL`**
(factual duration unknown — see §6). One multi-member composite:

| Field | Value |
|---|---|
| id | `32656b95-d509-4e0d-afca-af00680b2dd8` |
| canonical name | Self Guided Walking Tour San Telmo (part 1 of 3) |
| status | VERIFIED |
| source | agusyornet.com self-guided San Telmo walk (editorial) |
| member count | 13 |
| resolved members | 4 |
| unresolved members | 9 |
| distinct navigable GeoEntities | 4 |
| completeness | PARTIAL |
| dedupe / structural relation | NEW (`NO_EXISTING_CANDIDATES`, DISJOINT vs empty catalog) |
| selected into final Tour | **not materialized** (planning failed before Tour snapshot) |

Resolved members (source position → GeoEntity): Obelisco (PLACE), San Telmo
(AREA), Defensa Street (ROUTE), Casa Mínima (PLACE). Obelisco is ~1.9 km
north of San Telmo; it was admitted under source-defined descriptive scope
(§P2-18) — see §9.

Unresolved members, retained in source order with `sourcePosition`,
`sourceName` and `resolutionReason` (full table in
`analysis/cold-db-evidence.txt`):

| pos | sourceName | resolutionReason |
|---|---|---|
| 0 | Teatro Colón | AMBIGUOUS_CANDIDATES |
| 2 | Plaza de Mayo | AMBIGUOUS_CANDIDATES |
| 3 | Congress | NO_CANDIDATE_ACQUIRED |
| 6 | Farmacia la Estrella | CANDIDATE_UNCONFIRMED |
| 7 | Museum of the city | NO_CANDIDATE_ACQUIRED |
| 8 | La Librería del Avila | CANDIDATE_UNCONFIRMED |
| 9 | Monumento de Mafalda | CANDIDATE_UNCONFIRMED |
| 11 | The San Telmo Market | AMBIGUOUS_CANDIDATES |
| 12 | El Patio de los Ezeiza | CANDIDATE_UNCONFIRMED |

Integrity (`analysis/cold-db-evidence.txt`): `unresolved_with_geo = 0`,
`resolved_without_geo = 0`, `without_source_position = 0`,
`without_source_name = 0`. Every source member is a row; no unresolved member
was fabricated into a GeoEntity; no member was silently dropped.

## 4. Gather → Reconcile → Plan proof

Epoch chronology from the Generation Trace v5 (`analysis/cold-chronology.json`):

```text
catalog.snapshot      INITIAL                              epoch 0   (trace-step-5)
generation.gather     GATHER_START                          (trace-step-8)
planning.provisional  PROVISIONAL_PLAN_DISCARDED_FOR_REFILL epoch 4   (trace-step-116)
generation.gather     GATHER_COMPLETE                       epoch 5   (trace-step-131)
catalog.snapshot      FINAL_CATALOG_SNAPSHOT                epoch 5   (trace-step-132)
candidate_pool.selection  EXPERIENCE_POOL_RANKED            (trace-step-133, 18 offered)
ranking.semantic      APPLIED (18 candidates)               (trace-step-134)
[FAIL: feasibility validator — MAX_CONTINUOUS_WALKING_EXCEEDED]
```

- 5 acquisition executions (AREA_ROUTE_WALK, GENERIC, AREA_ROUTE_WALK,
  GENERIC, PLANNER_CAPACITY); 56 candidates materialized: NEW 18, SAME 11,
  AMBIGUOUS 0, REJECTED 27, ENRICHED 0.
- The provisional plan (epoch 4) was **discarded for refill**: the
  PLANNER_CAPACITY acquisition was authorized and the final plan recomputed
  from the epoch-5 snapshot.
- **`finalCatalogReadEpoch (5) >= lastAcquisitionEpoch (5)`** holds exactly:
  the FINAL snapshot was read after the last acquisition execution.

**Did late-acquired knowledge influence the final selection?** Not
demonstrable this run. The single composite was acquired in the **first**
acquisition execution (AREA_ROUTE_WALK), not in the PLANNER_CAPACITY refill;
no second composite (e.g. the SOB "Day 1" walk of the prior C3) was acquired
this run. The orchestration invariant (final snapshot read after the last
acquisition) is proven, but the specific "candidate learned in the final
acquisition phase changes the Tour" scenario was **not reproduced** by this
live evidence, and the final plan failed before materialization (see §9).

## 5. Tour result

No Tour snapshot was materialized. The `tour` row exists
(`4d10c9f9-3faf-4922-97e6-579c3c2e51f7`) but `tour_experience` and
`tour_experience_component` are both empty (`analysis/cold-db-evidence.txt`).
The generation failed at the feasibility validator before
`recordDailyPlanningStep` / `recordFinalSelectionStep` /
`recordTourMaterializationStep`, so the trace contains no `planning.daily`,
`selection.final`, or `tour.materialization` step.


Trace `result`: `acquisitionProvidersFailed: ["web"]` (Gemini 429 during the
second GENERIC pass extraction) and `degradedAcquisitionReason: null`. The
provider degradation did **not** cause the failure; the failure is a
deterministic planner/validator infeasibility on the freshly-composed final
candidate set (see §9). Per the run discipline, COLD did not qualify for
WARM and was not retried (the failure is deterministic, not an external
transient).

## 6. Duration behavior

All 18 persisted Experiences have `durationMinutes = NULL` (catalog
unknown/unknown — the Gemini extractor emitted no `suggestedDurationMinutes`).

| Check | Result |
|---|---|
| catalog `durationMinutes` = null/unknown | **PASS** (all 18 rows NULL) |
| catalog `duration` = undefined/unknown | **PASS** (`durationMinutes == null → duration undefined`, `experience-catalog.service.ts`) |
| planner candidate duration = `compositeDefaultDurationMinutes` | **PASS by code** — single authority `planning-candidate-normalizer.service.ts` (`durationMinutes ?? duration*60 ?? policy.compositeDefaultDurationMinutes`), default 90 (`daily-planning-policy.config.ts`) |
| any 120-minute unknown-duration authority | **ABSENT** (prior hardcoded 120 fallback removed) |

The 90-minute value is the uncalibrated planning fallback; no trace/Bitácora
step claims it came from source evidence. Duration enrichment is not
implemented (future spec
`docs/superpowers/specs/2026-10-08-experience-duration-knowledge.md`).

## 7. SAME reconciliation and structural dedupe

- 11 SAME decisions, all `SAME_SOURCE` + `EXACT_COMPOSITION`, all
  `reconciliation=NO_NEW_KNOWLEDGE` (single-place Experiences already
  resolved — no member knowledge to enrich). 0 ENRICHED.
- Structural relations observed in the trace: `EXACT_COMPOSITION` (22),
  `DISJOINT` (18), `SAME_SOURCE` (11), `SOURCE_UNKNOWN` (29). No
  `PARTIAL_OVERLAP`, `SUBCOMPOSITION`, or `AMBIGUOUS_DEDUPE` this run.
- No dedupe decision was made solely from `semanticSimilarity >= 0.58`
  (no `0.58`/AMBIGUOUS dedupe in the trace; `semanticSimilarity` appears only
  as ranking/classification diagnostics).
- `sharedSourceMembers` was not exercised this run (no cross-source overlap
  with shared members reached dedupe); the `MAX_DEPTH` truncation fix is code
  (`gather-reconcile-plan-2026-10-08`), unexercised here.

## 8. Identity / geography checks (fail-closed retained)

- No false VERIFIED observed. 22 verified-hint assertions exist, none for
  "National Bank"; National Bank was not a source member this run (the SOB
  "Day 1" walk was not persisted).
- Fail-closed identity outcomes retained: Plaza de Mayo AMBIGUOUS
  (`MATERIAL_COMPETITOR_KNOWN`), Teatro Colón AMBIGUOUS.

## 9. Root cause of the planning failure

The final fresh composition includes the composite `32656b95` whose 4
resolved members span Obelisco (~ -34.6037, -58.3816) to Casa Mínima
(~ -34.6167, -58.3713) via the San Telmo AREA and the Defensa Street ROUTE —
a span far larger than the San Telmo area. The greedy solver schedules with
approximate/fallback travel estimates (`greedy-daily-planning.solver.ts`),
but `tour-planning-feasibility-validator.service.ts` re-checks
`travelFromPrevious.walkingDistanceMeters` from real routing and raises
`MAX_CONTINUOUS_WALKING_EXCEEDED` on the composite's inbound leg
(`> 3000 m`). The generation then fails closed
(`experience-generation.service.ts:1539`).

This is **not** a regression in the GATHER → RECONCILE → FREEZE → PLAN code
(which is proven correct by §4). It is a pre-existing planner
feasibility/validator mismatch exposed because the final plan is now correctly
recomputed from the fresh post-acquisition snapshot, and that fresh
composition contains a composite whose descriptive-scope membership is
geographically spread. It is related to the documented `PF-CI-FLAKE-1`
(`MAX_CONTINUOUS_WALKING_EXCEEDED`) class and to composite-geography quality
(`RW4-RECONCILE-GEO-1` family).

## 10. Provider / runtime anomalies (not the failure cause)

- Gemini free tier 429 during the second GENERIC pass extraction (15 RPM
  limit) — failed that pass's extraction, recorded as
  `acquisitionProvidersFailed: ["web"]`.
- Wikidata proximity lookups timed out 4× (10 s); Geoapify text search timed
  out 1× ("Iglesia San Ignacio de Loyola").
- No extractor timeout; no ECONNRESET; the runner reached a terminal state.

## 11. Verdicts and remaining debt

- **COLD**: COLD_NOT_QUALIFIED (deterministic planner infeasibility; no Tour;
  WARM not run).
- **Structural correctness**: PASS (member identity stable; PARTIAL retains
  all 13 members; unresolved members not fabricated; no unioning; SAME
  reconciliation machinery correct).
- **Orchestration correctness**: PASS for the epoch invariant (final snapshot
  read at/after last acquisition; provisional plan discarded for refill). The
  "late-acquired candidate changes the Tour" scenario was not reproduced and
  the final plan failed — NOT demonstrated.
- **Duration correctness**: PASS (catalog unknown remains unknown; single
  90-minute planner fallback; no 120-minute authority).
- **WARM correctness**: NOT RUN (COLD did not qualify).

Remaining debt (unchanged; not blockers introduced here):

- `RW4-ATOM-SCOPE-1`: OPEN (SOB walk as continuation windows).
- `RW4-EXTRACT-STABILITY-1`: OPEN (same source extracts as 13 vs 15 members
  across runs; PARTIAL_OVERLAP keeps them unmerged).
- `RW4-RECONCILE-GEO-1`: OPEN, LOW (composite geography not jointly
  re-validated after enrichment).
- frontend unknown-duration "90 sugerido": OPEN
  (`fe/app/experiences/[id].tsx:216` `durationMinutes || 90`), display-only.
- known test flakes: `PF-CI-FLAKE-1` (`MAX_CONTINUOUS_WALKING_EXCEEDED`, now
  also observed in this live deterministic run).
- `CHAR-7`: pre-existing stale characterization expectation (35/36).

## 12. Engineering principles — PASS/FAIL

| Principle | Result |
|---|---|
| single policy authority (duration fallback) | PASS |
| unknown / no fabrication | PASS (no fake GeoEntity; no invented duration) |
| typed canonical boundaries | PASS (source-member rows typed; no metadata protocol) |
| provider isolation | PASS (no provider-name branching downstream) |
| source-member identity stability | PASS |
| structural dedupe authority | PASS (no semantic-0.58 authority) |
| fresh-snapshot final planning | PASS (epoch 5 == 5) |
| catalog reuse (WARM) | NOT RUN |
| no legacy/parallel authority | PASS (no 120-minute path remains) |
