# Preference-First Selection — CURRENT MAIN PROGRESS

Updated: 2026-09-14
Branch: `feat/preference-first-selection`
Repository: `jiseruk/zig-zag`
Canonical live-cutover plan: `docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`
Canonical implementation plan: `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
Canonical design: `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`

> This file is the CURRENT execution pointer. Older checkpoint detail remains available in Git history and must not override the current branch state below.
>
> Code wins over stale progress text. The cutover has progressed non-linearly: M4 is already landed and substantial M5 work is already landed. Do not revert later milestone work merely because an earlier milestone needed a forward correction.

## Current verdict

**M3.5 is COMPLETE / APPROVED by independent review.**

The previously identified Nominatim scope-resolution blockers are resolved:

1. JSONv2 provider classification is normalized once at the adapter boundary from `category` to the canonical internal `NominatimResult.class` field.
2. AREA-scale eligibility uses the provider-native numeric rank band `13..25`, so valid city/municipality ranks below 16 are accepted while county/broader (`<=12`) and street/more granular (`>=26`) scales remain outside the supported AREA band.
3. `DestinationResolutionService`, `AreaRouteAnchorResolverService`, and AREA hint resolution in `ExperienceProposalResolverService` share the same canonical `isAreaScaleEligible()` policy.
4. Unknown evidence remains fail-closed; bare nodes and non-administrative `boundary=*` results remain rejected.
5. There are no destination-name special cases and no duplicate AREA-scale authority.

Independent reviewer verdict: **✅ APPROVED**.

---

## Milestone status — real branch state

| Milestone | Status | Evidence / notes |
| --- | --- | --- |
| M0 | COMPLETE | Live-cutover call-graph/design audit documented. |
| M1 | COMPLETE | `PreferenceSpec` wired into the live orchestrator. Historical M1 commit: `8905f66...`. |
| M2 | COMPLETE | `FacetRetrievalService` + canonical sufficiency replaced legacy coverage authority. Relevant commits include `7c6555e...`, `d8a8828...`, `13ee702...`, `03a4728...`. |
| M3 | COMPLETE | `51989f321db6cb6bea7fbd6620a5714942723a91` — strategy selector + AREA/ROUTE/WALK acquisition live. |
| M3.5 | **COMPLETE / APPROVED** | JSONv2 normalization landed in `91ab491...`; rank hardening/fixes culminate in canonical branch commit `a38da85a26a514674d679bf78c0d27cbd2119538` (`13..25` + boundary regressions). |
| M4 | COMPLETE IN CODE | `8fac82d384cdbc20f54b004a2f3e428aa8285be3` — classification converges at the shared materialization boundary; AreaRouteWalk local classification authority removed. |
| M5 | **IN PROGRESS / PARTIALLY LANDED** | `09616dd...` adds preference-first composition; `3a7e965...` adds canonical venue-anchor resolution; `a7b841...` adds venue-anchor tests/hardening. P1 C5 semantic handoff and pinned-MUST implementation are implemented in the current worktree, awaiting package commit/review; C5b remains pending. |
| M6 | **C4 CORRECTED — awaiting independent review** | Independent review found weak-facet weighting and ignored typed planner signals; correction landed in `827b3ce`. P1 implements C5 semantic handoff and pinned MUST lifecycle; C5b duration-aware reservoir backfill remains pending. |
| M7 | NOT COMPLETE | Superseded legacy deletion milestone not yet closed against the current checklist. |
| M8 | NOT COMPLETE | Trace v4 + Bitácora v4. |
| M9 | NOT COMPLETE | Full verification matrix + no-dual-pipeline architecture acceptance. |
| M10 | BLOCKED | RW1 rerun only after the required cutover gate and separate authorization. |

---

# C4 — planner candidate contract

Status: **C4 CORRECTED — awaiting independent review**. The previous C4
implementation failed independent review on two blockers: weak matches were
counting toward planner preference weight, and an ordinal `rankingScore` made
the planner ignore typed preference/quality signals. M3.5 remains
**COMPLETE / APPROVED**; this correction does not reopen or redesign it. C5
and C5b remain unimplemented.

- Starting remote HEAD: `d16ebf44ac2010c1fbc7cbc9db1c09cf08659b5e`.
- Previous implementation commit: `83b5dce` (`feat(cutover-C4): wire planner preference contract`) — failed independent review.
- Correction commit: `827b3ce` (`fix(cutover-C4): preserve canonical preference scoring`).
- Execution-contract commit: `827b3ce`.
- `PlanningExperienceCandidate` now carries optional `preferenceWeight`,
  `mustInclude`, and raw canonical `qualityScore` (0..5).
- `preferenceWeight` is produced by the shared strong-match policy, summing the
  weights of distinct strongly satisfied requested facets. Weak quality,
  geography, or degraded-classification matches contribute zero; duplicate
  representations count once; semantic similarity/name/description cannot
  establish facet truth.
- `mustInclude` is true only for IDs returned by the resolved MUST venue-anchor
  contract. Soft anchors, AREA/ROUTE anchors, high preference matches, and
  unresolved MUST anchors do not set it; unresolved anchors do not synthesize
  candidates.
- `qualityScore` is read from `Experience.qualityScore`; transformed ranking
  `qualityBonus` is no longer exposed as planner quality.
- `rankingScore` is removed from the live planner candidate contract. Planner
  sorting and placement share one explicit formula: semantic contribution plus
  strong `preferenceWeight` plus raw canonical quality normalized from 0..5
  exactly once. Unknown quality is neutral.
- Initial selected candidates and the ordered reservoir use the same typed
  normalizer context/maps; no separate future-backfill candidate shape was
  introduced. Reservoir promotion itself remains C5b scope.

Fresh verification for C4:

- Targeted normalizer/matcher/planner suites: **6 suites passed, 96 tests passed**.
- Targeted planner-boundary characterization suites: **2 suites passed, 6 tests passed**.
- Full unit: **143 suites passed, 1,443 tests passed**.
- Integration: **16 suites passed, 72 tests passed**.
- Typecheck: **PASS**.
- Lint: **PASS**.
- Build: **PASS**.
- Full characterization: **7 non-DB suites passed, 2 DB-backed suites failed
  at setup** because the repository disposable-database guard rejected the
  configured target `localhost:5432/zigzag`. Exact guard message: `Refusing to
  TRUNCATE a database that is not provably disposable (localhost:5432/zigzag).
  Point DATABASE_URL at a dedicated test database (e.g. zigzag_test) or set
  ALLOW_DESTRUCTIVE_TEST_DB=1.` No guard bypass was attempted.

Architecture gate:

- single semantic authority: **PASS**;
- strong-vs-weak facet consistency: **PASS**;
- no double counting: **PASS**;
- raw canonical quality scale: **PASS**;
- hard-feasibility isolation: **PASS**;
- typed boundary contract: **PASS**;
- single normalization path: **PASS**;
- rankingScore ordinal override: **PASS — removed from planner handoff**;
- no provider-specific planner logic: **PASS**;
- no parallel legacy path: **PASS**;
- deterministic behavior: **PASS**.
- mustInclude transport-only: **PASS**;
- C5/C5b untouched: **PASS**.

### C4 overlap-priority correction — implementation checkpoint

Starting fork HEAD for this task: `51315f64d95b148cf75504d7edaf3b8d1ebc7198`.

Independent-review regression addressed: equal-component overlap filtering
was receiving `CandidateScoreBreakdown.totalScore`, which had collapsed equal
`preferenceWeight` candidates and could let lexical Experience ID decide the
winner instead of the ordering already chosen by composition.

Implementation commit: `610c14e` (`fix(cutover-C4): preserve composition priority through overlap filtering`).

Exact fix:

- `CandidateSelection` now carries `compositionOrderScoreById`, derived once
  from `composition.result.selected` followed by `composition.result.reservoir`.
- Orchestration carries that ordinal into overlap filtering as the transient
  `compositionOrderScore` field; `CandidateScoreBreakdown.totalScore` is no
  longer overlap authority.
- The overlap tie-break now uses component count, then composition order, then
  lexical ID. `PlanningExperienceCandidate` and planner semantics are
  unchanged; `rankingScore` was not restored.

Fresh verification for this correction (agent-executed):

- targeted overlap/composition/planner suites: **6 suites passed, 48 tests passed**;
- planner-boundary and shared-component characterization: **2 suites passed, 8 tests passed**;
- full unit: **144 suites passed, 1,444 tests passed**;
- integration: **16 suites passed, 72 tests passed**;
- typecheck: **PASS**;
- lint: **PASS**;
- build: **PASS**.

Full characterization: **7 non-DB suites passed, 32 tests passed**; **2 DB-backed
suites failed at setup** because the disposable-database guard rejected
`localhost:5432/zigzag`. No guard bypass was attempted.

Status remains: **C4 CORRECTED — awaiting independent review**. C5 and C5b
remain unimplemented.

---

# M3.5 — final accepted state

## Canonical policy

M3.5 owns one domain question:

> Is this Nominatim result a real, usable, bounded AREA-scale scope for destination/anchor resolution?

The canonical answer is `isAreaScaleEligible()`.

Current accepted rules:

- `osmType === node` → reject for polygon/boundary AREA use;
- provider classification must be normalized from JSONv2 `category` into internal `class` at the adapter boundary;
- `class === boundary` requires `type === administrative`;
- `class === place` is eligible only with supported numeric scale evidence;
- supported rank band is **13..25 inclusive**;
- rank `<=12` is too broad for this policy;
- rank `>=26` is too granular for this policy;
- `placeRank` is primary, `addressRank` is fallback when `placeRank` is unavailable;
- missing rank/classification fails closed;
- no `addresstype` whitelist is the source of truth;
- no destination-specific exceptions.

The same policy is consumed by:

1. `DestinationResolutionService`;
2. `AreaRouteAnchorResolverService`;
3. AREA component-hint resolution in `ExperienceProposalResolverService`.

## Final correction on canonical branch

Canonical branch implementation commit:

`a38da85a26a514674d679bf78c0d27cbd2119538`

This reproduces the previously reviewed implementation tree exactly on the correct repository/branch and changes only:

- `be/src/modules/tours/utils/nominatim-match.util.ts`
- `be/src/modules/tours/utils/nominatim-match.util.spec.ts`
- `be/src/modules/tours/services/destination-resolution.service.spec.ts`

It:

- changes `AREA_SCALE_MIN_RANK` from `16` to `13`;
- adds explicit boundary coverage for ranks `12, 13, 15, 16, 25, 26`;
- proves `placeRank: 15, addressRank: 20` is accepted because rank 15 itself is valid;
- proves a rank-15 administrative city follows the AREA boundary-hydration path instead of degrading to point fallback.

## Verification evidence

Fresh verification was executed by the implementation agent against the byte-identical implementation tree before the repository-target correction:

- targeted M3.5 tests: **6 suites / 115 tests PASS**;
- full unit: **143 suites / 1,438 tests PASS**;
- integration: **16 suites / 72 tests PASS**;
- typecheck: **PASS**;
- lint: **PASS**;
- build: **PASS**.

Verification classification:

- remote commit/diff/code inspection on the accepted implementation: **reviewer-verified**;
- single-policy call sites and JSONv2 boundary normalization: **reviewer-verified**;
- Nominatim rank semantics used for the final correction: **reviewer-verified against provider documentation**;
- test/typecheck/lint/build execution counts: **agent-reported**, not re-executed by the independent reviewer.

Architecture gate from independent review:

- provider isolation: **PASS**;
- typed boundary normalization: **PASS**;
- single policy authority: **PASS**;
- unknown/fail-closed semantics: **PASS**;
- no destination/provider special cases: **PASS**;
- dependency direction: **PASS**;
- no duplicate legacy path introduced: **PASS**.

---

# M4 — current real state

Commit: `8fac82d384cdbc20f54b004a2f3e428aa8285be3`

Current code state:

- classification converges through `ExperienceAcquisitionService.materializeExecution()`;
- accepted results are grouped by canonical `experienceId`;
- classification reuse uses the canonical reuse predicate;
- evidence is scoped/unioned per canonical Experience;
- `AreaRouteWalkAcquisitionService` no longer owns a second classification policy/path.

Do not roll M4 back while continuing M5/M6.

---

# M5 — current real state

M5 is partially implemented, not complete.

Landed:

- `09616dd1098de80fe2064977ba7aef669d89c964`
  - `composition-set-cover.util.ts`;
  - `ExperienceCompositionService`;
  - live preference-first composition;
  - deterministic ranked reservoir;
  - semantic similarity / exploration tilt remain ranking-only.
- `3a7e965bcc185b7b42696fc52995813f246e8efa`
  - canonical venue-anchor resolution;
  - resolved must/soft venue IDs reach composition;
  - soft anchors boost rather than force;
  - unresolved must anchors are tracked.
- `a7b841c6517001184c52fbeb7722b818ec34ea65`
  - venue-anchor tests/hardening;
  - also contained earlier M3.5 rank hardening now superseded by the approved correction above.

Still pending before Checkpoint C can be called complete:

- complete planner-candidate contract (`preferenceWeight` / `mustInclude` as required by the current plan);
- true pinned feasible must-anchor behavior in planner placement;
- duration-aware reservoir backfill;
- bounded planner-capacity acquisition after reservoir exhaustion;
- later trace/Bitácora work remains M8.

---

# Verification semantics for future agents/reviewers

Use these labels strictly:

- **reviewer-verified** — actually inspected/executed by the current independent reviewer;
- **agent-reported** — reported by an implementation agent or commit/progress entry but not independently rerun;
- **not verified** — no reliable evidence available.

Never infer green execution merely because a progress file or commit message says it passed.

---

# Current execution pointer

## Master-plan continuous execution — P1 implementation checkpoint

Starting local/fork HEAD: `3d1c1d4d1fe25ebd88657c6775df993f71b1ff79`.

P1 is implemented in the worktree and remains **IMPLEMENTED — awaiting independent review**:

- composition preserves semantic similarity scores and typed ranking provenance;
- generation handoff keeps missing embedding scores observable as `null` while planner normalization remains neutral;
- MUST candidates are partitioned and attempted before regular candidates;
- local improvement cannot move or swap MUST candidates;
- routing repair removes non-MUST candidates before MUST candidates.

Fresh P1 verification: targeted 6 suites / 45 tests passed; full unit 145 suites / 1,448 tests passed; integration 16 suites / 72 tests passed; typecheck, lint, and build passed. No disposable DB reset was attempted.

P2/P3 implementation checkpoint: initial and reservoir collections now remain distinct through the internal composition boundary; bounded deterministic reservoir promotion uses duration-aware residual capacity, MUST preservation, shared normalization, and no-degradation/progress checks. Planner residual capacity and planner-capacity deficits are explicit typed metadata. Preference-aware overlap now compares canonical weighted preference coverage before component count, preserves MUST candidates, and context-free callers retain the old comparator. The legacy trace helper no longer infers theme coverage from names/metadata.

Fresh P2/P3 targeted verification: overlap/composition/trace 3 suites / 33 tests passed; typecheck and lint passed. Full backend unit/integration/build evidence remains green from the preceding P2 checkpoint (145 suites / 1,448 tests; 16 suites / 72 tests). P2 is **IMPLEMENTED — awaiting independent review**, with one material remaining gap: the plan requires a bounded planner-capacity acquisition pass after reservoir exhaustion; current code records the typed deficit but does not yet execute that pass.

P4 implementation checkpoint: superseded candidate-window selection and keyword theme-matching authorities were deleted; the large characterization harness now uses the direct ranking window, and a static single-orchestration-owner architecture test is present. P4 remains **IMPLEMENTED — awaiting independent review**. The canonical planner-capacity acquisition/requery pass is still not implemented, so M9/M10 remain blocked.

P5/P6 implementation checkpoint: new backend generation traces emit version 4 while V1/V2/V3 contracts remain readable; the frontend Bitácora recognizes v4 stage groupings and keeps technical detail/export behavior available. P5/P6 remain **IMPLEMENTED — awaiting independent review**. Backend trace targeted verification passed 3 suites / 30 tests plus typecheck, lint, and build. Frontend `tsc --noEmit` remains FAIL on pre-existing repository errors in API generics, notification typings, bottom-sheet/icon typings, and a missing `tailwind-variants` declaration; no error was reported in the modified Bitácora file.

M9 remains blocked: planner-capacity acquisition is not yet executed after reservoir exhaustion; native v4 trace payloads do not yet include the full convergence/classification dossier; the complete frontend matrix and disposable-DB characterization gate remain outstanding.

P7 database checkpoint: a dedicated local Postgres database `zigzag_test` was created and all 16 repository Prisma migrations were applied successfully. Fresh acceptance verification against that database passed 20 suites / 30 tests. Fresh characterization ran 8 suites / 36 tests, with 6 suites / 28 tests passing and 2 DB-backed suites / 8 tests failing during Prisma raw-SQL initialization. Fresh e2e verification reached the disposable database but failed across the DB-reset-dependent selection suites with Prisma `Invalid $executeRawUnsafe` / `$queryRawUnsafe` errors; the disposable-database guard itself passed. P7 remains **BLOCKED — implementation and DB verification incomplete** pending the canonical planner-capacity acquisition gap and DB-backed suite initialization repair.

The required frontend typecheck remains blocked by pre-existing repository errors outside the modified Bitácora file. No live Buenos Aires gate or M10 RW1 run was authorized by prerequisite state; RW1 has not been run.

Next gate: finish P2 acquisition convergence and complete the trace/Bitácora v4 contracts before M9 acceptance.

M3.5 is closed. Do not reopen it unless a new regression is demonstrated.

Next work must start from the **actual remote HEAD of `jiseruk/zig-zag` / `feat/preference-first-selection`** and must be stateless/new-chat.

Before implementing another milestone:

1. fetch current remote HEAD;
2. read this CURRENT MAIN PROGRESS;
3. read the live-cutover plan and relevant canonical design/implementation sections;
4. inspect the real M5/M6 implementation frontier rather than assuming the older linear milestone picture;
5. preserve completed M0–M4 and already-landed M5 work;
6. choose the next smallest coherent task from the real remaining M5/M6 gap;
7. update this progress before stopping.

The next frontier is **M5 completion / M6 planner handoff and backfill**, not M3.5 and not a restart from earlier checkpoints.

## STOP condition

Do not run RW1 and do not call the full live cutover complete until the later M5–M9 gates required by the canonical live-cutover plan are satisfied.

## 2026-09-14 M9 recovery — disposable database boundary

Starting local/fork HEAD: `c472924b552bb03b3cbe3bca82fdc83b9520eff9`.

The original DB initialization symptom was reproduced with a minimal
`SELECT 1`: sandboxed execution returned Prisma 7.3.0 `EPERM` because local
PostgreSQL access was denied by the execution environment. With local DB access
enabled, the same Prisma adapter and raw-query calls succeeded; the previously
reported DB-backed characterization failures were environment/setup failures,
not migration or SQL failures.

Recovery changes in this worktree:

- the shared reset helper now uses Prisma's tagged raw-query API with a
  source-controlled table list, and rechecks the disposable-database guard at
  the destructive boundary;
- E2E competitive/scale reset paths reuse the shared helper;
- a real Postgres regression resets the same migrated `zigzag_test` twice,
  verifies application rows are removed, confirms PostGIS and pgvector remain
  usable, and inserts/queries again;
- the provider-order characterization was updated from its superseded failing
  expectation to the already-landed canonical convergence behavior.

Fresh verification (agent-executed): characterization **8 suites / 36 tests
passed**; integration **17 suites / 73 tests passed** including the reset
regression; backend typecheck, lint, and build passed. E2E executed against
`zigzag_test` but remains red on existing M9 cutover gaps: stale v3 trace
assertions, large-corpus preference/planner expectations, and one deadlock
during the scale reset. P2 planner-capacity acquisition, the complete v4
convergence/classification dossier, frontend Bitácora verification, and the
Buenos Aires live gate remain outstanding. Status: **DB boundary repaired —
M9 still blocked, awaiting independent review**.

## 2026-09-14 M9/C5b completion evidence

Starting HEAD: `675f71356c689d2c3835d9b603b1c371a254c552`.

The stale competitive corpus contract was migrated in `27b5600` and the
remaining lifecycle/C5b test and scope corrections were committed in
`38cef45`. Competitive assertions now encode P7C directional preference,
facet coverage, exact-fit preference over generic quality, strict hard
exclusion, preference-delta selection change, no-strict-dominance, and
determinism. They no longer require global 100% cluster dominance.

The E2E harness now waits for generation terminal status plus relevant outbox
quiescence and isolates the unawaited image transport with a deterministic
test double. The dedicated `zigzag_test` verification is green:

- full E2E: 4 suites / 40 tests;
- competitive corpus: 17 tests;
- scale corpus: 7 tests;
- acceptance: 20 suites / 30 tests;
- integration: 17 suites / 73 tests;
- characterization: 8 suites / 36 tests;
- unit: 144 suites / 1,443 tests;
- architecture, typecheck, lint, and build: PASS.

C5b implementation is **IMPLEMENTED**. The canonical path is gated by
`RESERVOIR_EXHAUSTED` with meaningful residual capacity, then executes
`AcquisitionDeficit(global_capacity)` → acquisition plan/execution → canonical
materialization/persistence → catalog re-read → recomposition → replan. The
bounded pass count and no-progress termination are persisted in convergence
trace metadata. The point-radius resolver regression was fixed so this path
has a valid typed destination scope when no area boundary exists. Acceptance
evidence is **PASS** through the C5b integration, E2E, unit, and architecture
matrix listed above.

RW1 was rerun against `zigzag_spike_preb6` with local PostgreSQL, SerpAPI,
Nominatim, and Overpass. The five-minute cold observation was a harness
timeout only; persisted terminal evidence shows completion after **403,767 ms**.
All four routed providers completed, both discovery passes were `PASS`, and
`providersFailed` was empty. The cold result did not create a composed walk:
`AreaRouteWalkAcquisitionService` was not invoked, and the planner selected
five independent single-component venue Experiences. Correct product verdict:
**EXPECTED_B6_GAP**. A warm run without reset completed in **32,355 ms**, reused
the same five individual Experience IDs, and kept the catalog identity-stable;
it did not prove composed-walk reuse because no composed walk exists. The
previous `INFRASTRUCTURE_GAP / provider-coverage gap` label is superseded and
retained only as historical mistaken diagnosis. RW2 remains unauthorized.

## 2026-09-14 RW1 canonical B5 rerun correction

The current build was verified with runtime identity
`811830bde0ad81656c89f9ffa807e3fcb40e597f`. The earlier live process had
fallen back from invalid remote preference-interpreter credentials, producing
no interpreted anchor; that was the actual reason the earlier trace showed
`AREA_ROUTE_WALK=0`, not a defect in `buildPreferenceSpec` or the selector.

With a working local Ollama interpreter on a clean dedicated spike database,
the terminal cold trace proved:

- interpreter anchor: `San Telmo`, `area`, `must`;
- `PreferenceSpec.anchors`: the same `San Telmo` area anchor;
- unsatisfied deficit: `preference_facet`, `intent:walk`;
- partition: `AREA_ROUTE_WALK=1`, `GENERIC=1`, with only `theme:history` in
  generic;
- `AreaRouteWalkAcquisitionService.acquireOrReuse()`: invoked, outcome
  `no_result`;
- final generation: `completed` in **13,254 ms**.

No grounded multi-component walk was established, so the correct current RW1
verdict is **EXPECTED_B6_GAP**. The planner selected four independent
single-component venue Experiences. No warm run was started because there is
no composed-walk Experience ID to reuse. The current `google_places` failure
is retained as provider diagnostic data, but the B5 routing contract passed;
this run is not classified as an orchestration or infrastructure gap.
