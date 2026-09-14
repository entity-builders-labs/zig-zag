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
| M5 | **IN PROGRESS / PARTIALLY LANDED** | `09616dd...` adds preference-first composition; `3a7e965...` adds canonical venue-anchor resolution; `a7b841...` adds venue-anchor tests/hardening. Do not call all of Checkpoint C complete yet. |
| M6 | NOT COMPLETE | Planner candidate contract / pinned must-anchor semantics / duration-aware reservoir backfill remain pending according to the live-cutover plan. |
| M7 | NOT COMPLETE | Superseded legacy deletion milestone not yet closed against the current checklist. |
| M8 | NOT COMPLETE | Trace v4 + Bitácora v4. |
| M9 | NOT COMPLETE | Full verification matrix + no-dual-pipeline architecture acceptance. |
| M10 | BLOCKED | RW1 rerun only after the required cutover gate and separate authorization. |

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
