# GATHER_RECONCILE_PLAN — 2026-10-08

Track `preference-first-selection`, branch `feat/preference-first-selection`,
base HEAD `9e5a6c9a`. Not merged. No live C3 was run.

Design truth: `docs/architecture/activity-discovery-and-tour-generation.md`,
section "gather, reconcile, then plan (2026-10-08)".

Files here:

- `c3-refill-replay.ts`: read-only replay of the post-refill composition
  against the C3 DB `zigzag_spike_rw4_c3_partial`. It needs local Ollama
  only. Output: `c3-refill-replay.txt`.
- `mutate.py`: the mutation runner (§12).

## 1. Old interleaved call flow (`df71a9cf`..`9e5a6c9a`)

`ExperienceGenerationService.generateTourExperiences`:

1. `findVerifiedWithin(bbox circle)` → `nearbyExperiences` (eligibility
   filtered). Anchor rows went into `allEligibleExperiencesById`, which was
   never cleared, but not into the first composition.
2. `composeExperiences(nearbyExperiences)` → first ranking.
   `computePreferenceCoverage` (its own PostGIS read) → sufficiency.
3. When insufficient, up to `MAX_ACQUISITION_PASSES` coverage passes ran:
   work units → `areaRouteWalkAcquisition.acquireOrReuse` (rows hydrated by
   a second projection, `hydratePersistedExperience`) and
   `executeAndMaterializeAcquisitionPlan` → `refreshCatalogAndRecompose`.
   The refresh merged new rows INTO the accumulating map; rows it did not
   return kept stale objects. Then recompose and recompute coverage.
4. `recordOfferedCandidates(selection)` accumulated candidates, weights,
   scores and must-includes into maps that only grow.
5. Overlap filter over `candidateExperiencesById` in insertion (discovery)
   order → normalize → solve → reservoir promotion.
6. When residual capacity remained and the reservoir was exhausted, the
   `PLANNER_CAPACITY` acquisition ran, then `refreshCatalogAndRecompose`
   with a different window (request point + 25 km) and different venue
   inputs (soft ids and anchor names dropped). Replanning used only the
   refreshed initial pool, with no reservoir promotion. **The replan was
   adopted only on strict progress** (more scheduled stops or more minutes);
   otherwise the pre-refill plan became the Tour.
7. The trace recorded `candidate_pool.selection` / `ranking.semantic`
   before planning, and only from the pre-refill selection. The refreshed
   selection and `convergence.stopReason` were not traced.

The candidate ranking snapshot was first created at step 2. It was reused
after catalog writes through the growing maps (steps 3, 4, 6) and through
the pre-refill plan (step 6).

### Why the C3 SOB 15/8 Experience was persisted but not selected

Read-only replay against the C3 DB (`c3-refill-replay.txt`), using the real
catalog read, composition and overlap filter, with the same
`buildPreferenceSpec` input and local `nomic-embed-text`:

- Both AG `42211eec` and SOB `03e3222c` are in the refill window (19 rows).
- The post-refill composition **selects SOB** (preference weight 3.00:
  history + architecture + walk; similarity 0.644) and puts AG first in the
  reservoir (weight 0.00, similarity 0.826).
- The overlap filter keeps SOB and excludes AG, in either discovery order.

The C3 Tour still contains AG, and AG is not in the refreshed initial pool
at all. So the refreshed replan was computed and **not adopted**: under step
6's strict-progress rule the stale pre-refill plan (3 POIs + AG, 570 min)
was kept. The diagnosis is from the code plus this replay; the planner
itself was not replayed, because routing would call geoapify.

## 2. New flow (GATHER → RECONCILE → FREEZE → PLAN)

```text
readCatalogSnapshot(INITIAL)   → catalog.snapshot INITIAL
compose → coverage             → coverage.analysis, catalog.search
[insufficient] generation.gather GATHER_START
  per pass: work units → acquisition executions (epoch++)
            readCatalogSnapshot(GATHER) → compose → coverage
planFromSelection(selection)
while residual capacity ∧ RESERVOIR_EXHAUSTED ∧ passes < max:
  planning.provisional (PROVISIONAL / ACQUISITION PLANNING)
  PLANNER_CAPACITY execution (epoch++)
  readCatalogSnapshot(GATHER) → compose → planFromSelection
ACQUISITION_COMPLETE_FOR_GENERATION   (guard: snapshot epoch == epoch)
generation.gather GATHER_COMPLETE → catalog.snapshot FINAL
candidate_pool.selection (FINAL_RANKING) → ranking.semantic
feasibility → planning.daily (FINAL_PLAN) → selection.final → Tour
```

- `readCatalogSnapshot` is the one snapshot read: the destination window
  (PD1-eligible) + `findVerifiedByIds(venue must/soft + AREA_ROUTE_WALK
  ids)`, deduplicated and sorted by id. It replaces
  `refreshCatalogAndRecompose`, `hydratePersistedExperience`, both windows
  and the accumulating maps, which are all deleted.
- `planFromSelection` derives the overlap filter (composition order), the
  normalization, the solve, the reservoir promotion and the residual
  capacity from ONE selection.
- Every compose uses the same canonical inputs (must, soft, anchor names).
- The legacy `availableExperiencesText` / `formatExperienceForPrompt` (an
  unused pre-V2 LLM prompt) is deleted.

## 3. Acquisition completion boundary

`ACQUISITION_COMPLETE_FOR_GENERATION` is the point after the
planner-capacity loop. Every acquisition execution increments
`acquisitionEpoch`, and every snapshot records the epoch it was read at. At
the boundary, a snapshot older than the last execution throws (fail
closed). By construction the loop always re-reads after an execution. When
no acquisition followed the last read (catalog-first, or no refill), that
read is the final snapshot: it was taken after every catalog write of the
generation. A re-read there would return the same rows and cost a second
planner run (routing).

## 4. SAME enrichment policy

`utils/source-knowledge-reconciliation.policy.ts`, applied in
`ExperienceCatalogService.persistVerifiedExperience`'s SAME transaction:

- eligible only for SAME + `EXACT_COMPOSITION` (explicit check, although
  SAME already implies it today); otherwise `NOT_ELIGIBLE`;
- correspondence = the dedupe authority's `sharedSourceMembers`; a legacy
  member without `sourcePosition`, or incomplete coverage, → `NOT_ELIGIBLE`;
- an unresolved canonical member becomes RESOLVED (`resolutionSource:
  AUTOMATIC`, reason cleared) when its corresponding observed member resolved
  it. Members that correspond through a shared GeoEntity resolve together and
  stay separate members;
- a resolved member is never downgraded; id, positions, wording and member
  count never change;
- a `RESOLUTION_REVOKED` member is not re-learned
  (`ADMIN_REVOKED_NOT_RELEARNED`): automatic knowledge never overrides an
  admin revoke.

Evidence, trait and metadata merge are unchanged.

## 5. Conflict policy

When a correspondence class holds two different GeoEntities, the
observation writes no member knowledge (`CONFLICT_REJECTED`), the conflicting
members are reported as `CONFLICT`, and there is no tie-break. In practice
the dedupe authority already refuses SAME: a wording that resolves to two
GeoEntities is no member identity, so the relation is not EXACT. The policy
check is defense in depth (unit test 3, mutation M4).

## 6. Final candidate snapshot

`readCatalogSnapshot` reads through `ExperienceCatalogService`
(`findVerifiedWithin` + `findVerifiedByIds`) and keeps no state between
reads. The final composition, semantic similarity (pgvector at compose
time), preference weights, overlap filter, normalization and plan are all
recomputed from it. Facet coverage is still `computePreferenceCoverage`
(its own PostGIS read).

## 7. PLANNER_CAPACITY before and after

| | Before | After |
|---|---|---|
| Role | backfill after the "final" ranking | bounded GATHER work, before the boundary |
| Pre-refill plan | became the Tour unless the replan strictly progressed | PROVISIONAL, always discarded when a refill runs |
| Post-refill read | different window, merged into stale map | `readCatalogSnapshot`, fresh |
| Post-refill compose | soft ids and anchor names dropped | canonical inputs |
| Post-refill plan | initial pool only, no promotion | full `planFromSelection` (with promotion) |
| `stopReason` | from the adoption check | from the final plan's own promotion loop |
| Budgets | `maxAcquisitionPasses`, ledger | unchanged |

The phase stays: residual capacity is only known from a plan.

## 8. Embedding freshness

The SAME write already nulled `embedding` and its index identity in the
transaction, and the resolver reindexes synchronously
(`embeddingIndexer.index`, `semanticDocumentChanged`). Enriched members are
resolved, so they enter the semantic document. The vector store requires a
non-null vector with matching identity, so a stale vector is never scored.
If the provider is unavailable, the Experience is in the explicit "no
compatible embedding" tier. Test 12/13 runs the whole lifecycle with the
real indexer and vector store on Postgres. Mutation M7 (keep the vector and
its identity) is killed. Removing only `embedding = NULL` survives, because
the nulled identity columns alone already exclude the vector: defense in
depth.

## 9. Discovery-order invariance

Snapshots are sorted by id. Composition already sorted by id. The overlap
filter now gets composition order instead of insertion order. Seam test 8
swaps which of two overlapping Experiences is window-found and which is
acquired: the universe, selection, reservoir, overlap exclusions and plan
are identical. The reconciliation is order-independent too (policy test:
poorer→richer equals richer→poorer).

## 10. Trace changes

- `catalog.snapshot` (INITIAL, FINAL): eligible ids, epoch, and per
  composite completeness, source-member, resolved and navigable counts
  (from the new `sourceMembership` projection field).
- `generation.gather` GATHER_START / GATHER_COMPLETE: executions (pass,
  unit, source plans, candidates, per-candidate NEW/SAME/AMBIGUOUS/rejected
  + Experience id + reconciliation), affected ids, executed source-plan
  fingerprints. It is named `generation.*`, not `acquisition.*`: it is a
  boundary marker, and catalog-first runs must keep having no
  `acquisition.*` step.
- `planning.provisional`: planned ids, stop reason, residual, whether a
  refill was authorized.
- `selection.final`: for every final candidate, the composition role,
  preference coverage, semantic similarity and outcome (`PLANNED day N #k |
  OVERLAP_EXCLUDED | PLANNER_UNSELECTED reasons | RESERVOIR_NOT_PROMOTED`),
  plus `convergence`.
- `catalog.materialization` `persistence.reconciliation`: outcome,
  resolved before/after, and per changed member: position, wording,
  before/after state, observed GeoEntity, evidence source.
- `dedupeEvidence.sharedSourceMembers` is now flat strings
  (`incoming[0] = existing[1] (SOURCE_WORDING, RESOLVED_GEOENTITY)`), so
  `MAX_DEPTH` no longer cuts it.

## 11. Historical behavior impact

Dedupe replay (the probe from `semantic-overlap-threshold-forensic`,
attached to unit + characterization + integration, at `HEAD` exported with
`git archive` vs this change):

- 122 pre-existing tests call dedupe, 287 calls;
- 0 decision flips and 0 structural-relation flips;
- the new calls come only from the 17 new tests.

Changed expectations in pre-existing tests: one, the trace representation
of `sharedSourceMembers` (`trace-failure-semantics.spec.ts`), which this
brief requested. No behavior expectation changed.

Intentional behavior changes:

- after a refill the final plan always comes from the fresh snapshot
  (previously only on strict progress);
- the first composition now includes resolved venue-anchor rows: the
  previous code hydrated them "so a must anchor is eligible" but composed
  without them until a refresh;
- AREA_ROUTE_WALK rows use the catalog projection: an unset duration
  defaults to 120 min (catalog) instead of 90 (deleted orchestrator
  projection), and the orchestrator's `explorationFacts` copy is gone;
- the post-refill compose uses the canonical venue inputs;
- the planner-capacity deficit counts the current snapshot, not the
  accumulated map (trace text only).

### C3 under the new pipeline (generic, nothing hardcoded)

- AG ARW 15/3 → NEW `42211eec`, unchanged.
- PC AG 13/5 vs `42211eec`: PARTIAL_OVERLAP (13 vs 15 members, 10 shared),
  so it is NOT eligible for enrichment. It stays AMBIGUOUS and is not
  persisted. The richer AG knowledge is still not merged. This is correct:
  two extractions of one page that disagree on membership are not the same
  source composition under the structural authority. Closing it needs
  stable extraction (follow-up), not a looser merge.
- SOB 15/8 → NEW `03e3222c` in the refill → in the FINAL snapshot → final
  composition selects it, the overlap filter keeps it over AG (replay) →
  final plan from that selection. Planner feasibility of the 8-member SOB
  walk inside the day was not replayed (routing).
- If a later observation is EXACT + SAME, its new resolutions reach the
  canonical Experience before the final snapshot.

## 12. Tests, mutations, tooling

New tests:

- `source-knowledge-reconciliation.policy.spec.ts` (11, through the real
  `decideExperienceDedupe`): brief tests 1–5 and 14, revoke, shared
  GeoEntity, legacy, order;
- `source-knowledge-reconciliation.integration-spec.ts` (7, Postgres):
  brief tests 1–5, 12/13, 14, 15;
- `gather-reconcile-plan.integration-spec.ts` (2, real orchestration):
  brief tests 6, 7, 9, 10, 11, 20, plus the no-acquisition path;
- `experience-generation.gather-reconcile-plan.spec.ts` (4): brief tests
  8, 9, 11, and snapshot eligibility;
- `trace-failure-semantics.spec.ts` (+1): serialization survives
  `MAX_DEPTH`.

Brief tests 16–19: the partial-composite, dedupe, identity (decision replay
above) and acquisition-budget suites are all in the green unit and
integration runs.

Mutations (`mutate.py`; each one applied alone, the file restored after):

| Mutation | Killed by |
|---|---|
| M1 final candidate set reuses the pre-gather array | gather-reconcile-plan integration |
| M2 refill-persisted Experience omitted | gather-reconcile-plan integration |
| M3 SAME enrichment does not copy a newly resolved member | reconciliation integration (3 tests) |
| M4 enrichment overwrites a conflicting resolution | policy test 3 |
| M5 discovery order changes the candidate universe | seam tests (2) |
| M6 final ranking skipped after gather | gather-reconcile-plan integration |
| M7 stale vector + identity treated as current | reconciliation 12/13 |
| M8 provisional plan leaks into the Tour | gather-reconcile-plan integration |

Tooling (final code, `zigzag_test` where a DB is needed):

| Check | Result |
|---|---|
| unit | 206/206 suites, 2923/2923 |
| integration | 28/28, 133/133 |
| e2e | 4/4, 41/41 |
| acceptance | 20/20, 30/30 |
| characterization | 35/36; CHAR-7 `A vs [B]` fails identically at `HEAD` (pre-existing stale expectation, already recorded by the two previous milestones) |
| typecheck, `lint:check`, prettier `--check`, `git diff --check` | clean |

## 13. Remaining debt

- Final-plan quality depends on composition and planner semantics that this
  milestone did not change (deferred: multi-intent, must-see/diversity,
  city-discovery, day trips, itinerary balance).
- Reconciled resolutions are not jointly re-validated by composite geography
  against the canonical set. Each was validated by the observation that
  resolved it, inside the same source composition.
- Divergent extractions of one source unit (AG 15 vs 13 members) stay
  separate or AMBIGUOUS. The fix is extraction stability, not a merge.
- Not done here: magic-number dedupe thresholds, Plaza de Mayo/Cabildo
  provider quality, identity recall, atomization continuation scope
  (RW4-ATOM-SCOPE-1).
- `computePreferenceCoverage` keeps its own PostGIS read (separate
  responsibility, unchanged).
