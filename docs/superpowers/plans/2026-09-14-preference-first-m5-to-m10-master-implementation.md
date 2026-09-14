# Preference-First Selection — M5 completion through M10 RW1 master implementation plan

Status: **implementation-ready master plan**  
Written: 2026-09-14  
Repository: `jiseruk/zig-zag`  
Branch: `feat/preference-first-selection`  
Canonical remote: `fork`  
Reviewed baseline HEAD: `8bb46987599573f97fff543257a271b37876ba7a`

This document supersedes milestone-by-milestone implementation improvisation for the remaining Preference-First live cutover. It does **not** replace the canonical design/specs. It translates the current real branch state into one executable sequence from the post-C4 frontier through the M10 RW1 rerun gate.

Canonical sources remain:

- `AGENTS.md`
- `docs/superpowers/contracts/preference-first-agent-execution-contract.md`
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`
- `docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

If this master plan conflicts with a domain invariant in the canonical design, the domain invariant wins. If it conflicts with stale older implementation sequencing, this master plan wins for the remaining work because it was written against the current branch state.

---

## 1. Current real state at the baseline

At `8bb46987599573f97fff543257a271b37876ba7a`:

- M0–M4 are landed; M3.5 has independent approval.
- M5 composition is substantially landed:
  - `composition-set-cover.util.ts` exists;
  - `ExperienceCompositionService` exists;
  - venue MUST/SOFT resolution exists;
  - selected + deterministic reservoir ordering exists inside composition;
  - evidence-backed exploration tilt is ranking-only;
  - embedding-backed semantic similarity is computed inside `ExperienceCompositionService`.
- C4 planner candidate contract is functionally complete and independently approved:
  - `PlanningExperienceCandidate.preferenceWeight` exists;
  - `mustInclude` exists as transport-only marker;
  - raw canonical `qualityScore` exists;
  - planner sorting and placement share `plannerRelevanceScore()`;
  - ordinal `rankingScore` is absent from the planner;
  - overlap filtering uses a separate pre-planner `compositionOrderScore`.
- `must-anchor-placement.util.ts` exists but currently owns only unresolved-MUST translation; it does not pin planner placement.
- `GreedyDailyPlanningSolver` does not special-case `mustInclude`.
- local improvement and day ordering/repair may move/remove ordinary and must candidates alike.
- the live planner receives only `selection.experiences` (initial selected portfolio); the composition reservoir is not yet exposed to the planning loop.
- duration-aware reservoir backfill and planner-triggered capacity acquisition do not exist.
- trace is still v3.
- Bitácora has no native v4 contract.
- superseded legacy pieces have not yet been deleted.
- M9 full cutover verification and no-dual-pipeline gate are not complete.
- M10 RW1 rerun remains blocked until M9.

### Known C4-adjacent live handoff bug that must be fixed before C5b

`ExperienceCompositionService` already computes real embedding similarity through `ExperienceVectorStoreService`, but `ExperienceGenerationService.composeExperiences()` currently fabricates:

```ts
semanticSimilarity: null
```

inside `CandidateScoreBreakdown`, so `PlanningCandidateNormalizerService` maps the live planner `semanticScore` to neutral `0` even when composition had a real compatible similarity score.

This does not reopen C4's preference/quality contract. It is a live handoff gap that must be repaired before planner backfill/convergence is built, otherwise the backfill planner would operate on incomplete relevance data.

---

# 2. Execution model — stop going milestone by milestone

This plan is intentionally designed to be executable **continuously**.

An implementation agent may execute packages P1 through P8 in one brand-new stateless session, committing after each package, provided:

1. the canonical fork stays fast-forward compatible;
2. each package's mandatory targeted checks pass;
3. no closed architectural premise becomes materially false;
4. no safety/infrastructure gate requires destructive bypassing;
5. no task crosses into M10 live-provider execution without explicit authorization in the execution prompt.

The agent MUST NOT stop merely because one package finished. It proceeds automatically to the next package when the package exit gate is green.

A separate stateless chat per package is also valid when context/token pressure makes that more efficient. Every package below is therefore self-contained enough to be resumed from CURRENT MAIN PROGRESS.

### Mandatory stop conditions

STOP only when one of these is true:

- current remote code materially invalidates a closed design premise in this plan;
- a required deterministic invariant fails and fixing it would require a design not specified here;
- the branch/worktree diverges and cannot be fast-forwarded safely;
- unrelated dirty changes exist;
- a required disposable DB/live-provider environment is unavailable;
- a real-provider/live gate produces a failure classification that this plan explicitly says requires human/architect review;
- M10 is reached without explicit authorization to run RW1.

Do not stop for ordinary compilation/test failures that are clearly caused by the current package implementation; fix those within the package.

---

# 3. Global decisions already closed

Do not reconsider these while executing this plan:

1. **One orchestration authority.** No request-shape branch may fall back to a legacy pipeline.
2. **Strong facet truth is canonical and shared.** Semantic similarity/exploration cannot satisfy coverage.
3. **Planner hard feasibility remains authoritative.** MUST does not bypass hard constraints.
4. **Raw quality is `0..5` and normalized exactly once in planner scoring.**
5. **Preference weight is the sum of distinct strong requested facets exactly once.**
6. **Embedding similarity is ranking-only and at most one query embedding per composition/generation context.**
7. **Unknown semantic/exploration evidence is neutral, not fake zero evidence.**
8. **Initial composition target is breadth, not final Tour cardinality.**
9. **Reservoir survives beyond initial target.**
10. **MUST venue anchors are pinned if feasible; unresolved/infeasible are explicit, not silently replaced.**
11. **SOFT venue anchors are boosts only.**
12. **AREA/ROUTE anchors are scopes, not selectable itinerary rows.**
13. **No invented walk/route from nearby places.**
14. **Classification remains evidence-only and provider-agnostic.**
15. **Identity/dedupe and geographic validation policy are not weakened.**
16. **`compositionOrderScore` is pre-planner overlap/dedup context only.** It never enters `PlanningExperienceCandidate`.
17. **C6 is a deliberate later evolution of overlap policy.** The currently approved C4 behavior (component-count first, then composition order) is an interim context-free comparator. When preference context exists, C6 must prioritize requested weighted coverage before the legacy component-count comparison.
18. **Legacy trace read compatibility remains.** Removing legacy orchestration does not delete V1/V2/V3 Bitácora rendering.
19. **No raw embedding arrays in trace/Bitácora.**
20. **No `ALLOW_DESTRUCTIVE_TEST_DB=1` as a shortcut.** Use a dedicated disposable test database.
21. **`fork` is the only write remote. `origin` is never written.**

---

# 4. Package P1 — finish the live semantic handoff, then C5 pinned MUST anchors

## P1 objective

Before implementing backfill, make the live planner receive the semantic score composition actually computed, then implement exact C5 pinned-MUST semantics throughout the full solver lifecycle.

## Required initial inspection set

Inspect first:

- `be/src/modules/tours/services/experience-composition.service.ts`
- `be/src/shared/ai/services/experience-vector-store.service.ts`
- `be/src/shared/ai/interfaces/embedding-index.interface.ts`
- `be/src/modules/tours/services/experience-generation.service.ts`
- `be/src/modules/tours/services/planning-candidate-normalizer.service.ts`
- `be/src/modules/tours/interfaces/daily-planning.interface.ts`
- `be/src/modules/tours/services/greedy-daily-planning.solver.ts`
- `be/src/modules/tours/utils/daily-planning-candidate-sort.util.ts`
- `be/src/modules/tours/utils/daily-planning-placement.util.ts`
- `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts`
- `be/src/modules/tours/utils/daily-planning-ordering.util.ts`
- `be/src/modules/tours/utils/must-anchor-placement.util.ts`
- nearby specs for those files.

Expand only when a concrete import/caller requires it.

## P1A — semantic similarity live handoff

### Contract

Extend `ExperienceCompositionOutput` with actual semantic-ranking output, without inventing a second embedding call:

```ts
semanticSimilarityById: Map<string, number>;
semanticRanking: {
  status: 'not_requested' | 'applied' | 'unavailable';
  requestedCandidateCount: number;
  indexedCandidateCount: number;
  identity?: EmbeddingIndexIdentity;
  reason?: string;
};
```

Implementation rules:

- reuse the single `getSimilarityScores()` result already obtained by `ExperienceCompositionService`;
- if semanticQuery is empty: `status='not_requested'`, empty map;
- if vector store result is applied: copy its real scores map and real counts/identity;
- candidates absent from the map are **unknown/unindexed**, not a factual similarity of zero;
- composition may continue to use neutral `0` internally for ordering fallback, but observability/handoff must preserve absence as unknown;
- if provider/index unavailable: `status='unavailable'`, empty map, reason/identity retained;
- no per-candidate embedding generation.

`ExperienceGenerationService.composeExperiences()` must build `CandidateScoreBreakdown.semanticSimilarity` as:

```ts
semanticSimilarityById.has(id)
  ? semanticSimilarityById.get(id)!
  : null
```

and use `composition.semanticRanking` rather than the current synthetic `indexedCandidateCount: 0` outcome.

`PlanningCandidateNormalizerService` continues to convert `null/undefined` to planner-neutral `0`; real known similarity reaches `semanticScore` unchanged.

### Required P1A regressions

Prove:

- composition calls vector store at most once for one generation/composition call;
- known similarity reaches `CandidateScoreBreakdown` and then `PlanningExperienceCandidate.semanticScore`;
- missing candidate embedding remains trace-observable as `null` while planner gets neutral 0;
- unavailable embedding provider does not fail generation;
- semantic similarity remains unable to create/strengthen facet coverage.

## P1B — C5 pinned MUST placement

### Canonical pinned semantics

Extend `must-anchor-placement.util.ts` so it owns deterministic partitioning/translation for MUST candidates.

Recommended pure helper shape:

```ts
partitionMustIncludeCandidates(candidates): {
  must: PlanningExperienceCandidate[];
  regular: PlanningExperienceCandidate[];
}
```

Both partitions preserve the canonical deterministic planner ordering within themselves.

Solver sequence becomes:

```text
route candidates
→ deterministic relevance sort
→ partition MUST / regular
→ attempt all MUST first through ordinary hard-feasibility checks
→ then regular greedy placement
→ bounded local improvement with MUST protection
→ routed day ordering/repair with MUST protection
```

Hard feasibility remains unchanged.

### Placement rules

- MUST candidates attempt placement before regular candidates.
- An infeasible MUST is returned unselected with the concrete hard rejection reasons already produced by the solver.
- Never manufacture a replacement venue.
- Orchestration maps resolved MUST candidates that remain unselected after final repair to `UnmetAnchor.reason = 'INFEASIBLE'`.
- unresolved venue MUST remains `UNRESOLVED` through the existing utility.
- tour generation continues when a MUST is infeasible.

### Local improvement rules

A placed MUST is pinned.

For v1, use the conservative deterministic rule:

- `tryMove` never moves a `mustInclude` candidate;
- `trySwap` never swaps a pair when either side is `mustInclude`.

This avoids an optimizer changing the chosen day/placement after the pinned pass. Do not invent a separate objective for MUST moves in this package.

### Ordering/repair rules

Current repair removes the lowest-priority candidate until the day can be routed/scheduled. Change removal selection so:

1. remove the lowest-priority **non-MUST** candidate first;
2. never remove a MUST while any removable non-MUST remains;
3. if the retained set contains only MUST candidates and the routed schedule is still infeasible, remove the lowest-priority MUST and report the concrete hard reason; this becomes exact `INFEASIBLE` upstream.

A MUST is therefore pinned against soft optimization/repair, but never allowed to violate a hard schedule constraint.

### P1 acceptance

Required cases:

- resolved+feasible MUST is scheduled even when lower soft score than competitors;
- resolved but impossible MUST produces exact `INFEASIBLE` and tour still succeeds;
- unresolved MUST remains exact `UNRESOLVED`;
- local improvement cannot evict/move/swap a placed MUST;
- ordering repair removes ordinary candidates before MUST;
- hard feasibility remains identical for MUST and ordinary candidates;
- soft anchors remain unforced.

### P1 exit gate

Run targeted semantic/composition/normalizer/planner/MUST tests, then full backend unit + integration + typecheck + lint + build. Update CURRENT MAIN PROGRESS and continue automatically to P2 when green.

Suggested implementation commit:

`feat(cutover-C5): pin feasible must anchors and preserve semantic handoff`

---

# 5. Package P2 — C5b duration-aware reservoir backfill and bounded convergence

## P2 objective

Make final Tour cardinality planner-driven, expose the composition reservoir to orchestration, backfill deterministically when useful capacity remains, and perform bounded capacity-driven acquisition only after the reservoir is exhausted.

## Required initial inspection set

- `experience-generation.service.ts`
- `experience-composition.service.ts`
- `composition-set-cover.util.ts`
- `planning-candidate-normalizer.service.ts`
- `greedy-daily-planning.solver.ts`
- `daily-planning.interface.ts`
- `daily-planning-policy.config.ts`
- `experience-acquisition-plan.interface.ts`
- `experience-acquisition-planner.service.ts`
- `experience-acquisition.service.ts`
- preference sufficiency utilities/tests.

## P2A — expose selected and reservoir separately

Change the internal `CandidateSelection` boundary so it carries both hydrated collections:

```ts
initialExperiences: any[];
reservoirExperiences: any[];
```

Do not collapse them back into one pool before the initial solver pass.

For compatibility during the refactor, the old `experiences` name may temporarily alias `initialExperiences` within one commit only if needed to keep compilation green; remove the alias before P2 exits.

The same maps apply to both initial and reservoir candidates:

- semantic similarity;
- preferenceWeight;
- raw quality;
- mustInclude IDs;
- composition order.

No second normalization semantics for promoted candidates.

## P2B — residual-capacity contract

Add explicit planner convergence metadata/types rather than inferring from final row count.

Recommended interfaces in `daily-planning.interface.ts` or a tightly adjacent interface file:

```ts
interface PlannerResidualCapacity {
  dayNumber: number;
  availableMinutes: number;
  meaningful: boolean;
}

interface PlannerCapacityDeficit {
  origin: 'planner_capacity';
  dayNumber: number;
  availableMinutes: number;
  preferredFacets: Array<{
    dimension: string;
    key: string;
    weight: number;
  }>;
}
```

Add planner policy:

```ts
backfill: {
  minimumUsefulResidualMinutes: number;
  maxReservoirPromotionAttempts: number;
  maxAcquisitionPasses: number;
}
```

This is explicitly **planner policy**, not A4/pre-planner sufficiency. Use a documented configurable default for `minimumUsefulResidualMinutes` (initial default: 60 minutes) and one planner-triggered acquisition pass in v1. Do not reuse this threshold for facet/global pre-planner sufficiency.

Residual minutes come from the actual scheduled day:

```text
planningWindowMinutes - day.utilizationMinutes
```

A day is meaningful only when residual minutes meet planner backfill policy. Hard feasibility remains the ultimate authority; the threshold only decides whether another attempt is worth making.

## P2C — deterministic reservoir promotion

Initial solver input = only `initialExperiences`.

Then:

1. compute residual capacity;
2. if none meaningful, stop `CAPACITY_SATURATED_OR_TINY_GAPS`;
3. take next reservoir candidate in canonical reservoir order;
4. normalize using the exact same normalizer/maps as initial candidates;
5. re-run solver with previously admitted candidate pool + promoted candidate;
6. accept the promotion only when:
   - every previously placed MUST remains placed;
   - the promoted candidate is actually scheduled; and
   - planner objective does not degrade.

Canonical no-degradation comparison:

```text
A. placed MUST count must not decrease
B. sum(plannerRelevanceScore of final scheduled IDs) must not decrease
C. then require strict progress by scheduled count OR total utilization minutes
```

Use deterministic epsilon handling for numeric relevance comparisons.

If a promoted candidate is not feasible/progressive, record its rejection and continue to the next reservoir candidate. Bound attempts by reservoir size and policy; never loop forever.

Do not append candidates directly to planned days.

## P2D — reservoir exhausted → planner-capacity acquisition

Only when:

- residual capacity is still meaningful; and
- every existing reservoir candidate was exhausted/rejected; and
- planner backfill acquisition budget remains,

emit `PlannerCapacityDeficit`.

Do **not** mutate the existing pre-planner `AcquisitionDeficit` union to pretend this is `global_capacity`; planner capacity is a later-stage concept with day/time facts. Instead add an explicit translation boundary in orchestration that builds a bounded generic acquisition request from the planner deficit.

Acquisition targeting:

- use request destination/current resolved scope;
- include highest-weight PreferenceSpec facets as positive context;
- capacity minutes may inform desired duration language/filters only if the current acquisition interfaces can represent it without provider-specific planner logic;
- if duration targeting is not supported by source contracts, run the generic relevant-facet acquisition route and let canonical planner feasibility decide after persistence/re-retrieval.

New candidates MUST traverse the existing canonical chain:

```text
acquire
→ resolve
→ geographic validation
→ identity/dedupe
→ classification
→ persist
→ re-retrieve
→ composition/ranking refresh
→ planner normalization
→ replan
```

Never schedule a raw acquisition candidate.

After one planner-triggered acquisition pass:

- recompute composition against the expanded canonical catalog;
- exclude already considered/scheduled IDs;
- rebuild deterministic reservoir context;
- resume promotion/replan;
- stop on no-progress/budget exhaustion.

## P2 required tests

- long Experiences produce a valid final Tour below initial portfolio target without refill solely by count;
- short Experiences with meaningful capacity promote reservoir candidates and final scheduled count may exceed initial target;
- promoted candidate still obeys opening hours/travel/mobility;
- tiny residual gaps trigger no filler;
- rejected reservoir candidate does not create infinite retry;
- reservoir exhaustion emits structured planner-capacity deficit;
- planner-triggered acquisition candidate is unusable until persisted/re-retrieved;
- bounded acquisition/no-progress stops deterministically;
- repeated identical input gives deep-equal decisions;
- all MUST placements survive accepted backfill replans.

## P2 exit gate

Targeted C5b tests + full backend matrix. Update progress and continue to P3.

Suggested commit:

`feat(cutover-C5b): add duration-aware planning convergence`

---

# 6. Package P3 — C6 preference-aware overlap and semantic-authority audit

## P3 objective

Finish Checkpoint C semantics around overlap and eliminate any hidden secondary matching authority before deleting legacy pieces.

## P3A — C6 overlap policy

Current overlap comparator is:

```text
component count
→ composition order
→ id
```

Keep this as the **legacy/context-free fallback** for callers that have no PreferenceSpec/composition context.

For the preference-first generation path, overlap filtering receives explicit preference context. Extend `OverlapCandidate` with optional transient fields sufficient to compare factual user value without importing planner types:

```ts
weightedPreferenceCoverage?: number;
compositionOrderScore?: number;
```

`weightedPreferenceCoverage` must be exactly the canonical `preferenceWeight` already computed from distinct strong requested facets. Do not recompute matching inside the overlap filter.

Preference-aware comparator:

```text
1. higher weightedPreferenceCoverage
2. higher component count
3. higher compositionOrderScore
4. lexical id
```

Rationale: a large composite no longer automatically suppresses a substantially better preference match merely because it has more components. Component count still expresses subset/subsumption preference after requested weighted coverage ties.

Hard MUST protection: if exactly one overlapping candidate is a resolved MUST venue candidate, the MUST candidate wins unless it is already known hard-infeasible before this boundary. In the normal flow hard infeasibility is planner-owned, so overlap filtering should conservatively preserve the MUST candidate. Add optional `mustInclude` transient context to the preference-aware caller if needed.

Do not put any of these transient fields into `PlanningExperienceCandidate` beyond the existing canonical planner fields.

## P3B — exact orchestration handoff regression

Harden the nonblocking C4 test observation: add at least one test that traverses the real `recordOfferedCandidates → offeredCompositionOrderScoreById/preferenceWeight → overlapFilter` orchestration wiring, rather than manually connecting the filter inputs.

## P3C — semantic-authority audit

Audit:

- `TourCompletenessValidator`
- any `TourFormatCoverageValidator` if present;
- generation trace matching helpers;
- any remaining `theme-matching.util.ts` callers;
- any JSON/string keyword matcher used to decide factual preference coverage.

Rule:

- product completeness may inspect final scheduled Experiences against canonical facets, but it must call the same canonical preference matching/strongness primitives or consume already-computed canonical results;
- no independent keyword synonym engine may decide that a requested facet is met.

Repair any duplicate semantic authority discovered. This is part of P3, not deferred to M9.

## P3 tests

- preference-aware overlap: higher requested weighted coverage beats larger component count;
- equal weighted coverage falls back to component count;
- context-free callers retain current component-count-first behavior;
- MUST overlap is preserved;
- exact orchestration wiring regression;
- completeness does not use keyword-only coverage authority.

Exit with full backend matrix green.

Suggested commit:

`feat(cutover-C6): make overlap preference-aware`

---

# 7. Package P4 — M7 delete superseded legacy orchestration

## P4 objective

Delete dead live-cutover concepts only after P1–P3 are green.

## Required deletion candidates

Confirm import/call graph first, then delete when zero legitimate callers remain:

- `coverage-analyzer.service.ts` + obsolete tests;
- `candidate-window-selection.util.ts` + obsolete tests;
- `theme-matching.util.ts` + obsolete tests;
- private `rankAndSliceExperiences` / legacy `selectBoundedWindow` path;
- legacy global catalog-first rank/truncate functions with no non-tour caller;
- stale trace-generation keyword matching code.

Audit `candidate-ranking.util.ts` separately. Keep any still-legitimate generic scoring/trace types or refactor them to a more accurate name; do not delete blindly.

Do not delete:

- old persisted trace render compatibility;
- generic acquisition infrastructure;
- identity/dedupe helpers;
- geography helpers;
- any source adapter used by the canonical acquisition pipeline.

## Architecture test introduced here

Create/complete:

`be/test/architecture/single-orchestration-owner.architecture-spec.ts`

Static assertions:

- processor has exactly one generation ownership path;
- no legacy coverage analyzer import in live generation;
- no `selectBoundedWindow`/legacy window call in live generation;
- no old keyword theme matcher as coverage authority;
- no second request-shape orchestration branch.

## P4 exit

Import search + typecheck + lint + unit + integration + build green. Progress explicitly records deleted symbols/files.

Suggested commit:

`refactor(cutover-M7): remove superseded selection pipeline`

---

# 8. Package P5 — M8 backend Generation Trace v4

## P5 objective

Make the machine/audit trace represent the real preference-first stages and convergence loop without shaping it around current UI widgets.

## Required initial inspection set

- generation trace interfaces/builders;
- `experience-generation.service.ts`;
- resolver/acquisition trace helpers;
- current trace characterization tests;
- redaction utilities.

## Trace v4 canonical stage semantics

Use one v4 path for all new generations. Recommended stage sequence:

```text
preference_interpretation
scope_resolution
facet_retrieval
preplanner_sufficiency
acquisition (0..N)
classification/materialization details nested or linked to acquisition
composition
planning_initial
planning_backfill (0..N iterations)
planning_final
finalization
```

Exact internal names may follow existing trace conventions, but both anchored-walk and generic requests must produce the same structural v4 orchestration family.

Trace records at minimum:

### Preference / retrieval

- canonical facets with weights/source/required;
- anchors and resolved/unresolved status;
- explorationStyle separately;
- semanticQuery presence (redacted policy as appropriate);
- per-facet strong/weak counts + satisfied;
- initial global breadth target + distinct eligible count.

### Acquisition/classification

- deficit origin/reason;
- chosen strategy/sources/queries;
- accepted/rejected counts;
- evidence keys/source URLs where policy permits;
- classification `reused|classified|degraded`, prompt/model version and evidence keys;
- no user preference as classification evidence.

### Ranking/composition

- embedding status, identity metadata, candidate similarity or unknown/fallback reason; never vectors;
- exploration signals known/unknown + confidence/evidence/reason codes;
- exploration tilt contributions;
- reserved facets;
- soft boosts;
- forced MUST IDs;
- initial selected IDs;
- reservoir ordered IDs/count;
- preferenceWeight/quality context where useful;
- overlap exclusions with reason/winner.

### Planning/convergence

- initial normalized candidate IDs;
- initial placements/unselected hard reasons;
- MUST resolved/placed/unresolved/infeasible status;
- per-day residual capacity;
- each reservoir promotion attempt/result;
- planner-triggered acquisition deficits/passes;
- accepted/rejected replan objective comparison;
- final placements;
- final scheduled count;
- convergence stop reason.

## Trace redaction

Preserve exact diagnostics while redacting secrets. Never persist raw embedding arrays. Continue existing prompt/raw-response trace policy only where already allowed and redacted.

## P5 required tests

- all new live requests produce `version: 4`;
- generic and area+walk requests share v4 stage family;
- no old coverage stage becomes factual authority;
- embedding known/unknown provenance correct, no vectors;
- exploration unknown != zero;
- composition selected/reservoir recorded;
- MUST semantics recorded;
- backfill/acquisition convergence recorded;
- deterministic repeated input yields deterministic trace decision fields, excluding expected timing/provider nondeterminism.

Suggested commit:

`feat(cutover-M8): add generation trace v4`

---

# 9. Package P6 — M8 frontend Bitácora v4

## P6 objective

Render trace v4 natively while preserving legacy trace viewing.

## Required initial inspection set

- `fe/components/tour-details/GenerationBitacora.tsx`
- adjacent trace TS types/helpers/tests;
- existing Playwright/unit setup.

Implement the canonical product groupings from the 2026-09-11 plan:

1. Qué viaje entendimos
2. Destino resuelto
3. Cobertura de preferencias
4. Qué faltaba
5. Búsqueda de nuevas opciones
6. Verificación y clasificación
7. Selección de Experiences
8. Armado del itinerario
9. Resultado final

Primary view rules:

- short title;
- one-line purpose at most;
- 2–5 metrics/results;
- one short decision line;
- technical details collapsed.

Do not recompute backend semantics in React.

Must display:

- strong/weak counts and covered/missing facets;
- global initial target vs distinct eligible;
- acquisition reason/results;
- classification reuse/new/degraded;
- soft anchor vs MUST distinction;
- MUST included/UNRESOLVED/INFEASIBLE;
- initial composition count/reservoir count;
- initial planner placement vs backfill;
- planner-triggered acquisition if any;
- final scheduled count and stop reason;
- concise selected/unselected reasons supported by trace.

Technical details retain rule IDs, reason codes, provider queries/source URLs/evidence keys, model/prompt metadata, score breakdowns, timing and raw trace JSON. No vectors.

Legacy V1/V2/V3 renderer remains reachable.

## P6 tests

At minimum all C8 acceptance cases from the canonical implementation plan, including native v4 rendering and compact product copy.

Run frontend typecheck/lint/tests plus focused Playwright/component tests.

Suggested commit:

`feat(cutover-M8): render product Bitacora v4`

---

# 10. Package P7 — M9 deterministic acceptance, DB gates and architecture proof

## P7 objective

Turn the cutover into enforceable acceptance rather than relying on unit coverage.

## P7A — dedicated disposable DB infrastructure

The current characterization suite is blocked because it points at `localhost:5432/zigzag` and the guard correctly refuses destructive setup.

Do not bypass the guard.

Provide/document a dedicated test DB (recommended `zigzag_test` or the repository's existing accepted disposable naming convention), created/migrated through the normal Prisma path. Test scripts may require `DATABASE_URL` to point there.

The M9 matrix is not green until DB-backed characterization/e2e actually executes against a provably disposable DB.

## P7B — cold-catalog preference-first E2E

Implement/adapt `experience-selection-preference-first.e2e-spec.ts` with real Postgres/PostGIS and faked external transports for determinism.

Cover the canonical D2 matrix, including:

- multiple facets;
- semantic near-match cannot create coverage;
- semantic ranking among factual matches;
- iconic/local/balanced evidence-backed exploration behavior;
- missing embeddings/exploration evidence neutral;
- long-duration below-target valid result;
- short-duration reservoir backfill;
- capacity acquisition after reservoir exhaustion;
- tiny-gap no filler;
- convergence budget/no-progress;
- hard exclusion;
- soft anchor win and legitimate loss;
- MUST feasible/unresolved/infeasible;
- bare AREA excluded;
- area+walk grounded composite.

## P7C — large competitive corpus

Preserve hundreds-of-Experiences fixtures and adapt assertions to preference-first semantics:

- every requested facet gets >=1 strong match when available;
- initial size targets global breadth;
- final size is feasibility-driven;
- preference delta changes selected IDs;
- semantic/exploration deltas only reorder eligible matches;
- weighted preference coverage + quality dominates old global rank concepts;
- row/input ordering does not alter deterministic result.

## P7D — no-dual-pipeline live-style architecture acceptance

Complete Test L:

- one anchored area+walk request;
- one generic theme request;
- both produce trace v4 with same stage family;
- neither invokes deleted legacy authorities;
- processor has one generation path.

## P7E — area-walk cold/warm reuse E2E

- cold acquires/persists grounded multi-component walk;
- warm reuses same canonical Experience ID;
- specifically prove that walk is not reacquired;
- unrelated deficit acquisition may still occur.

## P7F — classification evaluation gate

Implement/adapt `classify-eval.command.ts` truthfully using stored original evidence metadata or a captured real-acquisition fixture corpus.

Report:

- id/name;
- themes/intents/traits;
- reasoningEvidence;
- model/prompt;
- accepted semantic facet count;
- malformed trait count;
- unevaluable rows explicitly.

Gate targets:

- >=90% hand-reviewed theme/intent precision;
- 0 malformed accepted traits;
- 100% accepted semantic facets have >=1 evidenceKey.

Commit report under `docs/superpowers/characterization/`.

Suggested commits may split deterministic tests from classifier report, but stay within P7.

---

# 11. Package P8 — M9 live Buenos Aires gate + full verification closure

## P8 objective

Run the final deterministic/full matrix and the formal Buenos Aires live characterization before RW1.

## P8A — formal Buenos Aires live spec

Use empty dedicated live-test catalog and real providers for:

- history;
- architecture;
- tango;
- visit;
- walk;
- San Telmo AREA anchor;
- Teatro Colón SOFT venue anchor;
- balanced exploration style;
- 2 days.

Assertions are exactly the canonical D7 requirements:

- each requested facet strong-covered or explicitly unmet for provider reality;
- explorationStyle never a facet;
- balanced tilt neutral;
- selected rows grounded with components;
- San Telmo polygon not scheduled;
- acquired walk grounded multi-component;
- classification provenance present;
- semantic ranking uses compatible persisted vectors when available and cannot alter factual coverage;
- exploration evidence cannot alter factual coverage;
- residual-capacity backfill grounded/bounded;
- v4 Bitácora renders the same decisions.

A provider outage/rate-limit is an explicit live-gate failure/degradation classification, not a reason to mock the provider silently.

## P8B — full deterministic matrix

Backend, from repository-standard scripts (adapt command syntax to actual package layout rather than blindly copying stale workspace examples):

- typecheck;
- lint;
- full unit;
- integration;
- e2e;
- acceptance;
- characterization including DB-backed suites on disposable DB;
- architecture tests;
- build.

Frontend:

- typecheck;
- lint;
- component/unit tests;
- Bitácora-focused Playwright/e2e;
- production build if repo standard supports it.

No suite may be described as green if it was merely skipped by environment setup.

## P8C — M9 exit record

CURRENT MAIN PROGRESS must explicitly record:

- M5 complete;
- M6 complete;
- M7 complete;
- M8 complete;
- M9 complete;
- exact commit SHAs;
- exact executed test counts;
- live BA gate verdict;
- remaining known nonblocking observations;
- M10 RW1 ready/blocked status.

Do **not** merge to `feat/experience-domain-v2` as part of this master plan unless separately requested. The current target is proving this branch through M10/RW1 first.

Suggested final M9 commit:

`test(cutover-M9): close preference-first verification gate`

---

# 12. Package P9 — M10 RW1 rerun

## Authorization rule

P9 may run only when the execution prompt explicitly authorizes **M10 / RW1 rerun**. Reaching P9 in a continuous agent session without that explicit authorization means STOP with `M10 READY — authorization required`.

## Required spike contract

Follow:

`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

and the existing dossier:

`spikes/rw1-san-telmo-historical-walk/`

Use the required real topology:

- SerpAPI forced; no Tavily fallback;
- real configured discovery/classification LLM;
- local Argentina Overpass;
- local Argentina Nominatim;
- real Places when production grounding uses it;
- dedicated clean Postgres/PostGIS spike DB;
- AI cache off/isolated;
- no hand-built candidates/component hints.

Before RUN 1:

- create/reset the dedicated spike DB through safe normal mechanisms;
- prove clean Zig-Zag tourism-knowledge counts;
- record provider snapshot timestamps;
- verify grounded-search DI resolves SerpAPI and not Tavily;
- verify provider credentials/config without logging secrets.

## RW1 request

Use the same human-level San Telmo AREA-scoped historical walk scenario as the prior dossier so results are comparable.

Run:

1. cold request;
2. inspect complete trace/dossier;
3. warm request without resetting DB;
4. compare reuse behavior.

## M10 success criteria

The previous primary verdict `ORCHESTRATION_GAP` MUST NOT recur.

Required observable facts:

- PreferenceSpec anchor reaches real scope resolution;
- walk/route facet + San Telmo scope reaches the AREA/ROUTE/WALK acquisition strategy when catalog lacks a strong match;
- acquisition output traverses canonical resolution/validation/classification/persistence;
- composition/planner sees the canonical result;
- trace is v4;
- Bitácora can render the decisions;
- warm request reuses the same persisted walk Experience if cold successfully created one;
- specifically no reacquisition of that walk on warm reuse.

Possible verdicts after the cutover:

- `PASS` — real grounded walk succeeds and warm reuse is proven;
- `EXPECTED_B6_GAP` — orchestration now correctly reaches the research primitive, but source/extraction cannot prove a real composed walk; acceptable as proof that the live-cutover gap is fixed, though it remains a product/research gap;
- `PROVIDER_COVERAGE_GAP` — real sources/providers cannot support the case; document honestly;
- `INFRASTRUCTURE_GAP` — provider/local infra prevents a valid run;
- `B5_OR_IDENTITY_BUG` — STOP, regression requiring repair;
- `ORCHESTRATION_GAP` — FAIL M10, cutover not actually complete.

Do not relabel a failure to make M10 green.

Commit/update the RW1 dossier and CURRENT MAIN PROGRESS with exact cold/warm evidence and verdict.

Do not start RW2–RW6.

---

# 13. Cross-package mandatory verification rules

After every package:

1. run its targeted tests fresh;
2. run backend typecheck/lint/build;
3. run full unit/integration when the package changes backend runtime semantics;
4. run frontend checks when package changes frontend;
5. update CURRENT MAIN PROGRESS with exact executed results;
6. fetch `fork` again before commit/push/final continuation;
7. preserve concurrent remote work safely;
8. never claim reviewer approval for the implementing agent's own work.

For continuous execution, package progress status is:

`IMPLEMENTED — continuous master-plan execution; independent final review pending`

until the user requests/receives independent review.

---

# 14. Master acceptance criteria before M10 is ready

All must be true:

1. real semanticSimilarity computed by composition reaches planner candidates;
2. no semantic/exploration signal creates facet truth;
3. feasible MUST anchors are pinned and cannot be soft-evicted;
4. unresolved MUST = `UNRESOLVED`;
5. hard-infeasible resolved MUST = `INFEASIBLE` and Tour may still succeed;
6. initial selected and reservoir remain separate until planner convergence;
7. reservoir candidates use the same normalizer/scoring contract;
8. final cardinality is duration/feasibility-driven;
9. useful residual capacity promotes reservoir candidates deterministically;
10. tiny gaps do not force filler;
11. reservoir exhaustion can emit planner-capacity deficit;
12. planner-triggered acquisition is bounded and canonical-persistence-first;
13. convergence terminates on no progress/budget/capacity;
14. overlap with preference context prioritizes weighted requested coverage before component count;
15. context-free overlap retains deterministic legacy comparator;
16. no hidden keyword semantic coverage engine remains;
17. superseded legacy orchestration files/symbols are deleted;
18. new generations emit native trace v4;
19. generic and area+walk requests share one orchestration stage family;
20. Bitácora v4 is native, compact and product-readable;
21. old traces remain viewable;
22. no raw embedding vectors are exposed;
23. large-corpus preference/semantic/exploration deltas behave according to canonical authority boundaries;
24. cold/warm walk reuse acceptance is green deterministically;
25. classifier evaluation meets evidence/precision guards;
26. no-dual-pipeline architecture test is green;
27. DB-backed characterization/e2e actually runs on a disposable DB;
28. full backend/frontend matrix is executed and green;
29. formal Buenos Aires live gate has an explicit acceptable verdict;
30. CURRENT MAIN PROGRESS marks M9 complete and M10 ready.

---

# 15. Expected files / hotspots

Likely modified/new during P1–P8 (not exhaustive; expand only via concrete dependencies):

Backend:

- `be/src/modules/tours/services/experience-composition.service.ts`
- `be/src/modules/tours/services/experience-generation.service.ts`
- `be/src/modules/tours/services/planning-candidate-normalizer.service.ts`
- `be/src/modules/tours/services/greedy-daily-planning.solver.ts`
- `be/src/modules/tours/interfaces/daily-planning.interface.ts`
- `be/src/modules/tours/config/daily-planning-policy.config.ts`
- `be/src/modules/tours/utils/must-anchor-placement.util.ts`
- `be/src/modules/tours/utils/daily-planning-placement.util.ts`
- `be/src/modules/tours/utils/daily-planning-local-improvement.util.ts`
- `be/src/modules/tours/utils/daily-planning-ordering.util.ts`
- `be/src/modules/tours/utils/candidate-overlap-filter.util.ts`
- generation trace interfaces/builders
- architecture/e2e/acceptance/characterization specs.

Potential deletions in P4:

- `coverage-analyzer.service.ts`
- `candidate-window-selection.util.ts`
- `theme-matching.util.ts`
- dead old selection methods.

Frontend:

- `fe/components/tour-details/GenerationBitacora.tsx`
- adjacent trace types/helpers/tests.

Docs:

- CURRENT MAIN PROGRESS after every package;
- characterization/classifier report;
- RW1 dossier at M10.

---

# 16. Non-goals through M10

Do not:

- implement B6 extraction redesign merely because RW1 may expose `EXPECTED_B6_GAP`;
- run RW2–RW6;
- redesign identity/dedupe;
- weaken geographic validation;
- create `NEIGHBORHOOD_WALK`;
- make exploration style a facet;
- synthesize localCharacter from low prominence;
- generate missing candidate embeddings synchronously during composition;
- create provider-specific planner logic;
- add a second preference-first orchestrator;
- rewrite Git history;
- push to `origin`;
- merge branches unless separately authorized.

---

# 17. Final continuous-agent instruction

An agent authorized to execute this master plan should behave as follows:

```text
fetch/sync fork
read AGENTS + execution contract + CURRENT MAIN PROGRESS + this master plan
verify material baseline assumptions

for P1..P8:
  implement package exactly
  run package verification
  fix ordinary implementation/test failures
  commit package
  update progress
  fetch fork and integrate only by safe fast-forward/concurrency rules
  continue automatically when green

if P9 explicitly authorized:
  run RW1 exactly per spike gate
  record cold/warm dossier and verdict
else:
  STOP at M10 READY

never redesign closed decisions
never write origin
```

This is the canonical remaining implementation sequence from the current branch frontier to the RW1 rerun gate.