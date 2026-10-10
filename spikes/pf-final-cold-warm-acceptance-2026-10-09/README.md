# Final Preference-First COLD → WARM acceptance after the merge blockers — 2026-10-09

Track `preference-first-selection`, branch `feat/preference-first-selection`.
HEAD `c17d88280f16ca5845dc3f3d5f8b34211096b227` ("fix(tours): keep overlap
convergence retrieval-only"). Not merged.

## 0. Lineage and purpose

```text
final COLD/WARM rerun 27315cf7 (zigzag_spike_rw4_final_rerun)
  → RW4_FUNCTIONAL_PASS_WITH_NONBLOCKING_QUALITY_DEBT
    (spikes/rw4-final-rerun-cold-warm-2026-10-08/README.md)
→ full PF review: merge blockers PF-REV-SNAPSHOT-WINDOW-1, RW4-ID-FALSE-VERIFY-2
→ both CLOSED (spikes/snapshot-window-fix-2026-10-09/,
  spikes/identity-false-verify-2-fix-2026-10-09/)
→ this run: brand-new DB, same request/providers/harness, COLD then WARM
```

The fresh catalog is part of the acceptance condition. An older catalog may
still hold the false `verifiedHintNames` entry for "National Bank", which
could bypass the corrected rule through `CATALOG_VERIFIED_HINT`.

Raw artifacts live in the campaign directory
`spikes/rw4-functional-composite-campaign-2026-10-05/` as
`pf-final-20261009-cold/` and `pf-final-20261009-warm/`: trace, manifest,
provenance, provider requests, DB snapshots and terminal Tour. `*.log` files
are gitignored, and their anomalies are extracted to
`analysis/provider-anomalies.txt`. The projections are under `analysis/`.
The previous dossiers are not modified.

## 1. Execution identity

| Field | COLD | WARM |
|---|---|---|
| HEAD / `runtime.buildCommit` | `c17d8828…` / equal | `c17d8828…` / equal |
| Provenance | `canonical: true`, no failures (dist `e2463f47…`) | `canonical: true`, no failures |
| Database | **`zigzag_spike_pf_final_20261009`**: new name, never used before, dropped/created/migrated | same DB, reused (no reset) |
| Run label | `rw4-composite-pf-final-20261009-cold` | `rw4-composite-pf-final-20261009-warm` |
| Tour id | `e7862054-f2e8-469b-a94a-68c64eedcc30` | `529324be-e59d-4923-980b-d46dc66a9645` |
| Request | `requests/c3-buenos-aires-san-telmo-self-guided.json` (same as the previous final) | same |
| Duration | 536 s | 244 s |
| Generation status | `completed` (4 Experiences) | `completed` (4 Experiences) |

Command (WARM uses `reuse` instead of `fresh`):
`DISCOVERY_EXTRACTOR_PROVIDER=gemini bash run.sh pf-final-20261009-cold
zigzag_spike_pf_final_20261009 fresh 3420 requests/c3-…json tavily`.

The provider topology matches the previous accepted final
(`provider-preflight.json`):
- grounded search `serper`;
- extractor and classification `gemini` `gemini-3.5-flash-lite`;
- web content `tavily`;
- places/routing `geoapify`;
- local Nominatim (8088) and Overpass (12345);
- preference interpretation `groq` `qwen/qwen3.8-27b`;
- embeddings local `ollama`.

## 2. COLD: sequence integrity (A)

`analysis/cold-chronology.json`:

```text
catalog.snapshot      INITIAL                                 epoch 0  (step 5, 0 eligible)
coverage.analysis     NEEDS_ACQUISITION (history, architecture, walk)   (step 6)
generation.gather     GATHER_START                                      (step 8)
planning.provisional  PROVISIONAL_PLAN_DISCARDED_FOR_REFILL   epoch 2  (step 74, residual 133.6 min)
generation.gather     GATHER_COMPLETE                         epoch 3  (step 106)
catalog.snapshot      FINAL                                   epoch 3  (step 107, 18 eligible, 3 composites)
planning.daily        DAILY_PLAN_BUILT (4 selected, 0 unselected)       (step 110)
selection.final       POST_RECONCILIATION_SELECTION           epoch 3  (step 111)
tour.completeness     TOUR_COMPLETE                                     (step 112)
tour.materialization  TOUR_EXPERIENCES_PERSISTED                        (step 113)
```

- Three acquisition executions ran: pass 1 AREA_ROUTE_WALK, pass 1 GENERIC
  and pass 1 PLANNER_CAPACITY. Materialized: NEW 18, SAME 4, AMBIGUOUS 1,
  REJECTED 25, ENRICHED 0.
- **`finalCatalogReadEpoch (3) >= lastAcquisitionEpoch (3)`**.
- The provisional plan was discarded and did not become final.
  - Provisional: `40dfef03, 1905f762, 6c6b51f3, a74081ee, 682fc0bf`.
  - Final: `eabaf1ee, 682fc0bf, af5c3f2e, 1905f762`.
  - `eabaf1ee` (secretsofbuenosaires "Day 1" walk) was persisted by the
    final PLANNER_CAPACITY execution and is the first stop of the final
    Tour. Late-acquired knowledge changed the final selection again.
- The validator runs before `planning.daily` is recorded. Both
  `DAILY_PLAN_BUILT` and `TOUR_EXPERIENCES_PERSISTED` are present.

## 3. Snapshot-window blocker, live check (B)

- The built runtime (`be/dist`, fingerprint above) contains only
  `findVerifiedWithinForMatching`.
  - It has no `findVerifiedWithin` (non-matching), no `take: 1000` and no
    `CATALOG_RETRIEVAL_POOL_LIMIT` (`grep` over `be/dist/src`).
  - `readCatalogSnapshot` (`experience-generation.service.ts:626`) reads
    only `findVerifiedWithinForMatching` plus explicit ids, sorted by id.
- Both COLD snapshots and the WARM INITIAL snapshot ran that path.
  - WARM INITIAL saw **all 18** COLD Experiences (eligible ids =
    COLD FINAL ids).
  - WARM FINAL saw 20 = 18 + 2 NEW.
  - No row in scope was missing from any snapshot.
- Trace note (pre-existing, not a visibility defect): with coverage
  SUFFICIENT, `catalog.search` lists the composed selection (4), not the
  snapshot (18) (`experience-generation.service.ts:1136`). The previous
  WARM shows the same behavior.

## 4. Identity, live check (C)

`analysis/cold-identity-audit.json`, `analysis/warm-identity-audit.json`
(`identity-audit.cjs` walks every `resolution.*` decision in the trace).

### National Bank: not exercised as an identity hint

- "National Bank" occurs only in source text and support spans: steps 26/27
  (GENERIC window) and step 86 (PLANNER_CAPACITY window). The atomizer
  classified it as `passBy` / `nonMembership` in steps 87/88 ("the
  headquarters of the National Bank" is a pass-by mention). It never became
  a component hint, so the identity resolver never ran on it.
- No GeoEntity "Edificio First National Bank of Boston" exists, and no
  "National Bank" key exists in `verifiedHintNames` or
  `geo_entity_verified_hint_assertion`, after COLD or after WARM.
- The live run therefore did **not** exercise National Bank. The blocker
  closure rests on the deterministic regressions and the 30-hint replay
  (`spikes/identity-false-verify-2-fix-2026-10-09/`). No synthetic data was
  injected.

### The corrected rule did execute live on two of the four tightened hints

| Hint | Run / step | Candidate | Convergence role | Decision | Memory |
|---|---|---|---|---|---|
| Farmacia la Estrella | COLD 95 | "Farmacia de la Estrella" | RETRIEVAL_ONLY | INSUFFICIENT_EVIDENCE / `NO_DECISIVE_EVIDENCE` → member UNRESOLVED `CANDIDATE_UNCONFIRMED` | none |
| El Zanjón de Granados | WARM 25 | "El Zanjón de Granados (historic ruins)" | RETRIEVAL_ONLY | INSUFFICIENT_EVIDENCE / `NO_DECISIVE_EVIDENCE` → REJECTED `UNCONFIRMED_MATCH` | none |

### OVERLAP/NONE promotion

- COLD: 68 decisions. WARM: 15.
- Convergence evidence appeared 7 times. Every time its role was
  RETRIEVAL_ONLY and the verdict was AMBIGUOUS or INSUFFICIENT_EVIDENCE.
- **0** VERIFIED decisions rest on a non-corroborating convergence.
- The COLD VERIFIED rules were:
  - GROUNDED_UNIQUE_EXACT_NAME 23;
  - GROUNDED_UNIQUE_ALIAS 2;
  - STRUCTURED_ROUTE 2;
  - CATALOG_ROUTE_VARIANT 2;
  - QID_LINK 1.
- The 3 WARM `CATALOG_VERIFIED_HINT` reuses (San Telmo Market, Metropolitan
  Cathedral, Cabildo) read memory written in this fresh COLD by
  EXACT_NAME/ALIAS decisions.

### NEW FINDING: PF-FINAL-ID-GENERIC-NOUN-1 (a false VERIFIED identity with durable memory)

- Source text (WARM, PLANNER_CAPACITY, "Tour Description" page): "…savor
  authentic empanadas". The atomizer emitted `empanadas` as a **venue**
  entity of the composite "Tour Description (part 1 of 4)" (step 22).
- Identity (step 27):
  - CATALOG / TRUSTED / LOCAL_OSM found no candidate.
  - NOMINATIM returned a shop named **"Empanadas"** at -34.58697,
    -58.41913. That is **5.6–6.0 km** from the composite's sibling members
    (Mercado de San Telmo 5,584 m, Plaza Dorrego 5,717 m).
  - It was VERIFIED by `GROUNDED_UNIQUE_EXACT_NAME`, with decisive evidence
    `EXACT_NAME/CORROBORATING` and `GEOGRAPHIC_CORRESPONDENCE/QUALIFYING`.
- Persisted state:
  - GeoEntity `b6e1d0d4-…` "Empanadas" (PLACE).
  - RESOLVED member at position 3.
  - **`verifiedHintNames = {empanadas}`**, plus an active AUTOMATIC
    assertion.
  - A later Buenos Aires source that mentions empanadas would resolve to
    this shop through `CATALOG_VERIFIED_HINT` without new evidence. That is
    the same harm class as RW4-ID-FALSE-VERIFY-2.
- Impact on this Tour: none. The composite was `OVERLAP_EXCLUDED`
  (REDUNDANT_WITH `eabaf1ee`).
- It is not the OVERLAP-convergence class, and the closed fix did not cause
  it. The exact-name rule and the atomizer labelling are unchanged by
  `c17d8828`. It is a latent defect that this run exposed, not a
  regression.
- First causal failure: **EXTRACTION_VARIANCE**. A non-place common noun
  (a dish) was labelled as a venue member: RW4-ATOM-SCOPE-1 /
  RW4-EXTRACT-STABILITY-1 family. The identity layer then accepted a unique
  exact name for a generic noun, within the bounded admission scope but
  about 5.7 km from the walk. Durable hint memory amplifies the error.
- Merge relevance: this is a proven false canonical identity with durable
  memory. The owner ruled the same consequence class merge-blocking for
  National Bank. This dossier therefore does **not** self-certify it as
  non-blocking (§11).

## 5. Partial composites (D)

`analysis/cold-db-evidence.txt`, `analysis/warm-db-evidence.txt`.

| Experience | Members | Resolved | Unresolved | Completeness | Selected |
|---|---|---|---|---|---|
| `eabaf1ee` Walking tour Buenos Aires – Day 1 (part 1 of 2) (secretsofbuenosaires) | 16 | 8 | 8 | PARTIAL | COLD + WARM, position 1 |
| `1b9f86bc` Self Guided Walking Tour San Telmo (part 1 of 3) | 17 | 5 | 12 | PARTIAL | no (WARM `OVERLAP_EXCLUDED`) |
| `40dfef03` Map of Avenida de Mayo (part 2 of 2) | 15 | 6 | 9 | PARTIAL | no (provisional only; `OVERLAP_EXCLUDED`) |
| `46f677a2` Tour Description (part 1 of 4) (WARM NEW) | 4 | 3 | 1 | PARTIAL | no (`OVERLAP_EXCLUDED`); holds the "empanadas" member (§4) |
| `d981826d` Tour Description (part 3 of 4) (WARM NEW) | 4 | 3 | 1 | PARTIAL | no (`OVERLAP_EXCLUDED`) |

- Integrity checks, COLD and after WARM: `unresolved_with_geo = 0`,
  `resolved_without_geo = 0`, `without_source_position = 0`,
  `without_source_name = 0`.
- The 8 unresolved members of `eabaf1ee` keep their source name and
  position:
  - PLAZA DE MAYO, Feria San Telmo, Club Atlético:
    `AMBIGUOUS_CANDIDATES`;
  - Museum of Modern Arts, national history museum:
    `CANDIDATE_UNCONFIRMED`;
  - "the oldest neighborhood…", "a big building with columns", "typical
    red walkway": `NO_CANDIDATE_ACQUIRED`.
- None was dropped, fabricated or replaced. The source-member rows of the
  three COLD composites are identical after WARM.
- Compared with the previous final, this walk's extraction has 16 members,
  not 18, and no "National Bank" member (it became pass-by). That is
  extraction variance (RW4-EXTRACT-STABILITY-1). The resolved set went
  from 7 to 8: National Bank left (it is pass-by now), and Casa Rosada
  (AMBIGUOUS before) and San Telmo resolved.

## 6. Walking (E)

Day 1 (COLD; WARM identical). Legs are the persisted
`tour_experience.travelFromPrevious` (`analysis/*-tour-walking.txt`), all
Geoapify with `approximate: false`. Planner routing: `fallbackCount 0`,
`approximateEstimateCount 0`.

| # | Experience | Inbound walking leg | Running external | + internal |
|---|---|---|---|---|
| 1 | `eabaf1ee` Walking tour – Day 1 (part 1 of 2) | none | 0 m | 4,431 m |
| 2 | `682fc0bf` Museo Histórico Nacional | 210 m | 210 m | 4,641 m |
| 3 | `af5c3f2e` Roca granitica | 799 m | 1,009 m | 5,440 m |
| 4 | `1905f762` Manzana de las Luces | 2,724 m | 3,733 m | **8,164 m** |

- External legs: 210 / 799 / 2,724 m.
- Internal legs of `eabaf1ee` (7 component legs, from
  `analysis/cold-internal-walking-replay.json`): 466, 197, 1,855, 547, 317,
  176 and 873 m, totalling 4,431 m.
  - The replay is read-only and uses the production normalizer with
    Resilient(Geoapify).
  - Its `internalWalkingMinutes` (68.8826) matches the live trace exactly:
    `totalExperienceMinutes` 428.8826 = 4 × 90 + 68.8826.
  - The persisted `duration` is 2.6480 h = (90 + 68.8826) / 60.
- Max continuous walking: **2,724 m** (external), with an internal max of
  1,855 m. Limit `maxContinuousWalkingDistanceMeters` = 3,000 m.
- Daily walking total: **8,164 m** (3,733 external + 4,431 internal).
  Limit `maxWalkingDistancePerDayMeters` = 10,000 m.
- `planning.daily`: `totalWalkingMinutes` 128.97 (60.09 external + 68.88
  internal), `unselectedCount 0`, validator passed. No post-ordering leg
  exceeds a limit, so the walking-ordering fix holds.

(Replay invocation note: run it from `be/` with
`TS_NODE_PROJECT=$PWD/tsconfig.json TS_NODE_BASEURL=$PWD
NODE_OPTIONS=--no-experimental-strip-types npx ts-node --transpile-only -r
tsconfig-paths/register <file>`. Node 24 type-stripping and the root
tsconfig otherwise break module resolution.)

## 7. Duration (F)

- COLD: 18/18 Experiences have `durationMinutes = NULL`. WARM: 20/20.
  No value is 120 in either run (`dur_120 = 0`).
- The 4 selected Experiences use the 90-minute planning fallback
  (`plannerDurationMinutes 90`, `PLANNING_FALLBACK`).
  - Unknown stays unknown in the catalog.
  - The planner applies the canonical typed fallback.
  - No backend 120-minute catalog fallback reappeared.

## 8. Persistence (G)

Both Tours have 4 `tour_experience` rows and 11
`tour_experience_component` rows:
- 8 for the composite, matching its 8 resolved canonical members, in
  source-member order (2, 3, 4, 7, 8, 10, 11, 14);
- 1 for each single-place Experience.

The persisted order, durations and legs equal `planning.daily` and
`tour.materialization` facts. No materialization mismatch was observed, so
PF-REV-MATERIALIZE-FREEZE-1 was not exposed.

## 9. WARM knowledge reuse

| | COLD | WARM |
|---|---|---|
| Initial snapshot | 0 eligible; `NEEDS_ACQUISITION` | 18 eligible; coverage `SUFFICIENT` |
| Acquisition executions / reason | 3: AREA_ROUTE_WALK, GENERIC, PLANNER_CAPACITY (coverage deficits, then residual capacity) | 1: PLANNER_CAPACITY (`RESERVOIR_EXHAUSTED`, residual 171.0 min) |
| Materialized | NEW 18, SAME 4, AMB 1, REJ 25 | NEW 2, SAME 4, REJ 9 |
| Classification | 18 CLASSIFIED, 4 REUSED | 2 CLASSIFIED (the NEW ones), 4 REUSED |
| Provider requests total | 922 | 484 |
| Non-routing | **435** | **108** |
| Gemini / Serper / Tavily | 68 / 3 / 3 | 16 / 1 / 1 |
| Wikidata / Nominatim / Overpass | 116 / 63 / 19 | 21 / 22 / 12 |
| Geoapify geocode / details | 51 / 51 | 12 / 7 |
| Geoapify routing | 487 | 376 |
| Final Tour | `eabaf1ee, 682fc0bf, af5c3f2e, 1905f762` | identical order |
| Legs / walking | 210 / 799 / 2,724 m; 128.97 walking min | identical |
| Snapshot components | 8 / 1 / 1 / 1 | 8 / 1 / 1 / 1 |

- The WARM catalog-only provisional plan was already COLD's final Tour.
  The capacity refill ran because the bounded refill policy authorizes one
  pass when the reservoir is exhausted. It is not rediscovery.
- The 4 SAME candidates reconciled with `NO_NEW_KNOWLEDGE`.
- Rejected candidates are re-resolved: missing catalog knowledge by
  design, since rejections are not persisted. This matches the previous
  final.
- The 2 NEW WARM composites are new web observations. Both were
  `OVERLAP_EXCLUDED`.
- Routing is planner work, not acquisition. No routing cache spans runs:
  efficiency debt, unchanged.

## 10. COLD/WARM comparison

| Dimension | COLD | WARM | Explanation |
|---|---|---|---|
| Tour Experiences | eabaf1ee, 682fc0bf, af5c3f2e, 1905f762 | same | catalog reuse |
| Component composition | 8 / 1 / 1 / 1 | same | same canonical rows |
| Resolved/unresolved (selected composite) | 8 / 8 of 16 | same | rows unchanged |
| Final ordering | 1–4 as above | same | deterministic planner over same inputs |
| Walking | ext 3,733 m, int 4,431 m, max leg 2,724 m, day 8,164 m | same | |
| Duration source | 90-min planning fallback; catalog NULL | same | |
| Catalog size (start → end) | 0 → 18 | 18 → 20 | 2 NEW web observations |
| Acquisition executions | 3 | 1 | refill only |
| Non-routing provider requests | 435 | 108 | reuse |
| Routing requests | 487 | 376 | planner trial solves |
| Identity decisions | 68 (VERIFIED 30, INSUFFICIENT 19, AMBIGUOUS 16, REJECTED 3) | 15 (VERIFIED 9 incl. 3 hint reuse, INSUFFICIENT 5, REJECTED 1) | WARM resolves only refill candidates; "empanadas" false VERIFIED (§4) |
| Ranking similarity | `eabaf1ee` 0.644 | 0.572 | the Groq interpretation varies; the accepted facets are identical; selection unchanged |

## 11. Known debt check

| Item | Observed? | Changed? | Merge-blocking? |
|---|---|---|---|
| PF-REV-MATERIALIZE-FREEZE-1 (MEDIUM) | no (no concurrency; persisted = planned) | no | no |
| RW4-WALKING-VALIDATOR-SEMANTICS-1 (LOW) | not triggered | no | no |
| RW4-EXTRACT-STABILITY-1 | yes: Day-1 walk 16 vs 18 members; "Tour Description" headings; dish as venue | it now produced a false identity (below) | no by itself |
| verifiedHint memory provenance (DEFERRED) | yes: "empanadas" memory has no rule/strength record | no | no by itself |
| CHAR-7 | not run (no code change) | no | no |
| RW4-ATOM-SCOPE-1 | related to the "empanadas" labelling | no | no by itself |
| **PF-FINAL-ID-GENERIC-NOUN-1 (new)** | yes, WARM | new | **owner decision**: same harm class as the closed blocker |

Provider anomalies (`analysis/provider-anomalies.txt`): COLD had one local
Nominatim socket hang-up ("the Cabildo"), which left that member
AMBIGUOUS. WARM had one Wikidata proximity timeout. There were no 429s,
fallbacks, approximate routes or classification failures.

## 12. Verdict

Every acceptance dimension A–G passes in COLD and WARM, and WARM proves
catalog-first reuse. Both closed blockers stay closed live:
- the PostGIS snapshot authority executed;
- no OVERLAP/NONE convergence was promoted;
- the corrected rule fired on Farmacia la Estrella and El Zanjón.

WARM did expose a new false VERIFIED identity with durable hint memory
(PF-FINAL-ID-GENERIC-NOUN-1). Its first causal failure is extraction
variance, and it does not touch this Tour. Its consequence class (false
canonical identity reusable through `CATALOG_VERIFIED_HINT`) is the one the
owner ruled merge-blocking for National Bank. Per the task contract, this
run does not certify it as non-blocking:

**FINAL_PREFERENCE_FIRST_COLD_WARM_BLOCKED**, pending the owner's
classification of PF-FINAL-ID-GENERIC-NOUN-1. If the owner rules it
non-blocking debt, this evidence supports
`FINAL_PREFERENCE_FIRST_COLD_WARM_ACCEPTED_WITH_NONBLOCKING_DEBT` without a
rerun.

### Smallest fix brief (if ruled blocking)

- Track/HEAD: `preference-first-selection` @ `c17d8828`.
- Finding: PF-FINAL-ID-GENERIC-NOUN-1.
- Defect: a generic non-place noun is VERIFIED by
  `GROUNDED_UNIQUE_EXACT_NAME` from a single Nominatim exact-name hit about
  5.7 km from the composite's other resolved members, and is written to
  durable hint memory.
- Smallest correction candidates, each an owner decision:
  1. Identity side: an exact-name match for a hint with no proper-noun
     identity content stays RETRIEVAL_ONLY unless a second qualifying
     signal exists. Identity content means a single common-noun token with
     no name evidence, judged by a typed name-specificity fact from the
     canonical name-correspondence authority, not a word list.
  2. Composite-geography side: a resolved member far outside the corridor
     of its sibling members is not VERIFIED by exact name alone.
  3. Extraction side: the atomizer must not label a non-place noun as a
     venue entity. This fixes the cause but not the defense in depth.
- Regression: "savor authentic empanadas" must give no VERIFIED identity,
  no GeoEntity write and no hint memory. Controls: Plaza Dorrego, Bar Sur
  and Casa Mínima stay VERIFIED by exact name.
- Forbidden: thresholds tuned to this case, destination special-casing,
  word blocklists, reopening the OVERLAP rule.
- Verification: unit/integration identity suites, the 30-hint replay
  (expect no change), and a fresh COLD.
