# Preference-First Selection — CURRENT MAIN PROGRESS

Updated: 2026-09-14
Branch: `feat/preference-first-selection`
Starting remote HEAD observed for this correction: `99e53abd864bfd814b5983e64b2c32033442556b` (available matching `fork/` ref; configured `origin` did not expose the feature ref).
Implementation commit for this correction: `103c43f`
Progress checkpoint commit: `f67dd74f38c21275db23821661a95060bba3b8f7`.
Canonical live-cutover plan: `docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`
Canonical implementation plan: `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
Canonical design: `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`

> This file is the CURRENT execution pointer. Older detailed A/B checkpoint history remains available in Git history (previous blob `5dace5f2d851ad733e8c33aaa25d9f4159b7f336`) and must not override the current cutover state below.
>
> Important: the cutover is NOT being executed strictly linearly. M4 has landed and substantial M5 work has landed while M3.5 is awaiting independent review. Do not revert later milestone work merely because M3.5 is not yet approved.

## Current verdict

**Current gate: M3.5 awaiting independent review.**

M3.5 is **IMPLEMENTED — awaiting independent review**. The JSONv2 adapter contract now normalizes the provider's `category` field into the canonical internal classification consumed by `isAreaScaleEligible()`.

The implementation and verification action is complete; the next action is independent review. Do not mark M3.5 approved from this progress update alone.

---

## Milestone status — real branch state

| Milestone | Status | Evidence / notes |
| --- | --- | --- |
| M0 | COMPLETE | Live-cutover call-graph/design audit documented. |
| M1 | COMPLETE | `PreferenceSpec` is wired into the live orchestrator; historical M1 commit is in branch history (`8905f66...`). |
| M2 | COMPLETE | `FacetRetrievalService` + canonical sufficiency replaced legacy coverage authority; subsequent M2 cleanup removed the legacy CoverageAnalyzer architecture from the live path. Relevant commits include `7c6555e...`, `d8a8828...`, `13ee702...`, `03a4728...`. |
| M3 | COMPLETE | `51989f321db6cb6bea7fbd6620a5714942723a91` — AcquisitionStrategySelector + AreaRouteWalk acquisition wired into the live orchestrator. |
| M3.5 | **IMPLEMENTED — awaiting independent review** | `103c43f` corrects the canonical AREA rank boundary from `16..25` to `13..25`, retaining the JSONv2 normalization from `91ab491...` and adding pure-policy plus destination consumer regressions. |
| M4 | COMPLETE IN CODE | `8fac82d384cdbc20f54b004a2f3e428aa8285be3` — semantic classification converges at the shared materialization boundary; AreaRouteWalk local classification authority removed. |
| M5 | **IN PROGRESS / PARTIALLY LANDED** | `09616dd1098de80fe2064977ba7aef669d89c964` adds preference-first composition; `3a7e965bcc185b7b42696fc52995813f246e8efa` adds canonical venue-anchor resolution; `a7b841...` adds venue-anchor tests/hardening and also modifies M3.5 rank policy. Do not call all of Checkpoint C complete yet. |
| M6 | NOT COMPLETE | Planner-candidate contract/backfill remains pending. Current `PlanningCandidateNormalizerService` does not yet carry the full canonical `preferenceWeight` / `mustInclude` contract. |
| M7 | NOT COMPLETE | Superseded legacy deletion milestone not fully closed against current plan checklist. |
| M8 | NOT STARTED / NOT COMPLETE | Trace v4 + Bitácora v4. |
| M9 | NOT STARTED / NOT COMPLETE | Full verification matrix + no-dual-pipeline architectural acceptance. |
| M10 | BLOCKED | RW1 rerun requires separate authorization and must happen only after the cutover reaches the required gate. |

---

# M3.5 — canonical scope-resolution unification

## Definition / acceptance intent

M3.5 owns one domain question:

> Is this Nominatim result a real, usable, bounded AREA-scale scope for destination/anchor resolution?

The policy must be shared, not independently reimplemented, across:

1. `DestinationResolutionService`;
2. `AreaRouteAnchorResolverService`;
3. `ExperienceProposalResolverService` AREA component-hint resolution where the same domain question is asked.

It must:

- accept real city / neighborhood / suburb / quarter-style bounded areas without a city/town/village-only whitelist;
- reject bare nodes when polygon/boundary geometry is required;
- reject non-administrative `boundary=*` concepts (protected areas, national parks, maritime/postal boundaries, etc.) when they are not the destination/anchor administrative/place concept;
- reject unbounded/top-level scopes such as country/state/region/county when they are outside the supported trip-area scale;
- fail closed on missing/unknown provider evidence rather than guessing;
- never special-case `San Telmo` or any destination name.

## Commit sequence actually present

### `dfc1b90f20dd815500fc8a4aff36f491e910f7df`

Initial M3.5 cutover:

- introduced shared `isAreaScaleEligible()`;
- replaced the old `city/town/village` destination whitelist;
- made `DestinationResolutionService` and `AreaRouteAnchorResolverService` share the same scope predicate;
- widened neighborhood-scale support structurally rather than by destination-name exception.

### `03e4ac08d484c1e5296243f80b687f3858d184ed`

Review correction:

- `class === 'boundary'` is no longer enough by itself;
- boundary-class results require `type === 'administrative'`;
- non-administrative boundary types fail closed;
- `ExperienceProposalResolverService` AREA-hint resolution was moved onto the same canonical predicate, eliminating the third duplicate `way/relation` policy site.

### Later hardening inside `a7b841c6517001184c52fbeb7722b818ec34ea65`

Although this commit is titled `test(cutover-M5): verify canonical venue anchor resolution`, its diff also materially changes M3.5:

- `NominatimResult` gains `placeRank` / `addressRank`;
- `NominatimApiService` maps `place_rank` / `address_rank`;
- `isAreaScaleEligible()` stops using a small `addresstype` exclusion set and instead requires positive numeric scale evidence;
- supported range is currently `16..25`;
- city / suburb / neighbourhood / quarter-style results remain accepted when their provider rank is in range;
- region / province / county / country / state-scale fixtures are rejected with broad ranks;
- unknown rank fails closed;
- tests were updated across destination/anchor/resolver call sites to carry rank evidence.

The direction is sound: use provider-native numeric scale evidence instead of growing a vocabulary whitelist.

## M3.5 correction — city-scale rank boundary

The reviewed implementation previously accepted only ranks `16..25`. That
artificial lower threshold rejected legitimate city/municipality-scale
Nominatim areas below rank 16, including the required `placeRank: 15` case.

Implementation commit: `103c43f`.

The canonical `isAreaScaleEligible()` policy now accepts ranks `13..25`
inclusive and continues to reject broader ranks `<= 12`, more granular ranks
`>= 26`, bare nodes, non-administrative boundaries, missing/unknown evidence,
and unknown classifications. Rank precedence remains `placeRank ??
addressRank`; the `placeRank: 15, addressRank: 20` regression proves that the
valid primary rank is not bypassed in favor of the fallback.

Tests added:

- explicit pure-policy boundary coverage for ranks 12, 13, 15, 16, 25, and 26;
- explicit administrative city regression for `placeRank: 15` and
  `addressRank: 20`;
- destination-resolution consumer regression proving rank 15 uses AREA
  boundary hydration and does not fall back to point-radius behavior.

Fresh verification for this correction:

- targeted: **6 suites passed, 115 tests passed**;
- `yarn typecheck`: **PASS**;
- `yarn lint:check`: **PASS**;
- `yarn test --runInBand`: **143 suites passed, 1,438 tests passed**;
- `yarn test:integration`: **16 suites passed, 72 tests passed**;
- `yarn build`: **PASS**.

Architecture gate: provider isolation **PASS**; typed boundary normalization
**PASS**; single policy authority **PASS**; unknown/fail-closed semantics
**PASS**; no destination/provider special case **PASS**; dependency direction
**PASS**; no duplicate legacy path introduced **PASS**.

---

# M3.5 REVIEW — BLOCKER FOUND 2026-09-14

## ❌ Blocker: JSONv2 returns `category`, adapter reads `class`

`NominatimApiService.search()` and `.reverse()` explicitly request:

```text
format=jsonv2
```

But the adapter interface currently declares/reads:

```ts
class?: string;
...
class: item.class
```

Nominatim JSONv2's real response contract renames the JSON-format `class` field to **`category`**. `place_rank` is present in JSONv2, but the provider classification comes back as `category`.

Therefore, with a real public Nominatim JSONv2 response:

```text
item.category = "place" | "boundary" | ...
item.class    = undefined
```

and the normalized domain object currently becomes:

```text
NominatimResult.class === undefined
```

`isAreaScaleEligible()` intentionally fails closed for unknown class, so a genuine San Telmo / city / neighborhood response can be rejected before boundary hydration even though the mocked specs are green.

This is a real production-contract blocker for M3.5, not a cosmetic naming issue.

## Why existing tests did not catch it

The adapter spec and downstream specs build mocked API payloads with `class`, so they encode the internal assumption rather than the actual JSONv2 wire shape. The new rank tests prove the deterministic rank policy, but they do not prove that real JSONv2 provider fields reach that policy correctly.

## Required correction before M3.5 approval

1. Normalize JSONv2 `category` into the internal provider-classification field (either `class` internally or rename the domain field consistently; do not support two competing policy fields downstream).
2. Keep `place_rank` normalization; `address_rank` may be treated only as optional/fallback evidence when actually supplied — M3.5 correctness must not depend on undocumented presence of it in JSONv2.
3. Add an adapter contract regression whose raw fixture is shaped like real JSONv2:

```ts
{
  category: 'place',
  type: 'suburb',
  place_rank: 19 | 20,
  ...
}
```

and deliberately has **no `class` field**.
4. Prove that the normalized result reaches `isAreaScaleEligible()` as a valid bounded place.
5. Add/retain real-shape coverage for an administrative boundary (`category:'boundary'`, `type:'administrative'`) and a non-administrative boundary rejection.
6. Retain broad-rank rejection and unknown-rank fail-closed semantics.
7. Re-run the M3.5-relevant unit tests plus full backend typecheck/lint/test/integration before requesting approval again.

Recommended extra verification: one live Nominatim contract smoke using the real configured format, without making live provider availability part of deterministic CI.

## Review verdict

**Previous verdict:** M3.5 was NOT APPROVED at implementation HEAD `a7b841...` because of the JSONv2 adapter mismatch.

The shared-policy architecture is materially better and the numeric-rank refinement is directionally correct, but the provider adapter does not currently honor the actual JSONv2 field contract required to feed that policy.

The blocker was fixed forward in `91ab491109b195277f264ad4bedea10c2f1d1947`. Do not revert M4/M5 work.

## M3.5 verification after JSONv2 adapter correction

Status: **IMPLEMENTED — awaiting independent review**

Implementation commit: `91ab491109b195277f264ad4bedea10c2f1d1947`

Integration-fixture commit: `e91ab40995fc577b41c4934c8773d33b9072b59d`

Files changed:

- `be/src/modules/integrations/osm/services/nominatim-api.service.ts`
- `be/src/modules/integrations/osm/services/nominatim-api.service.spec.ts`
- `be/test/integration/tour-generation/area-route-walk-geographic-validation.integration-spec.ts`

The adapter raw DTO now uses JSONv2's `category`, `place_rank`, and
`address_rank` names and maps them once to `class`, `placeRank`, and
`addressRank`. The regression fixture uses `category: 'place'` with
`type: 'suburb'` and `place_rank: 20`; it deliberately contains no synthetic
raw `class` field. Search and reverse both exercise the shared `mapResult()`
normalization, with reverse coverage also asserting `address_rank` mapping.

Targeted M3.5 tests: **6 suites passed, 107 tests passed**.

Full backend verification rerun on this implementation:

- `yarn typecheck`: **PASS**
- `yarn lint:check`: **PASS**
- `yarn test --runInBand`: **143 suites passed, 1,430 tests passed**
- `yarn test:integration`: **16 suites passed, 72 tests passed** (PostgreSQL Docker container `zigzag-postgres`, healthy and exposed on `localhost:5432`).
- `yarn build`: **PASS**

---

# M4 — current real state

Commit: `8fac82d384cdbc20f54b004a2f3e428aa8285be3`

Code state:

- classification converges through `ExperienceAcquisitionService.materializeExecution()`;
- accepted results are grouped by canonical `experienceId`;
- classification reuse uses the canonical reuse predicate;
- evidence is scoped/unioned per canonical Experience;
- `AreaRouteWalkAcquisitionService` no longer owns a separate classification policy/path.

The commit reports:

- `yarn typecheck` green;
- `yarn lint:check` green;
- full backend `141 suites / 1414 tests` green;
- integration `16 suites / 72 tests` green.

These are **agent-reported commit results**, not independently rerun by the reviewer in this progress update.

M4 should not be rolled back merely because M3.5 needs a forward fix.

---

# M5 — current real state

M5 is no longer “not started”. It is partially implemented on the remote branch.

## Landed

### `09616dd1098de80fe2064977ba7aef669d89c964`

- `composition-set-cover.util.ts` exists;
- `ExperienceCompositionService` exists;
- live orchestration calls preference-first composition instead of the previous bounded-window selection;
- composition exposes selected IDs plus a deterministic reservoir;
- canonical facet matching/strong-match semantics are reused;
- semantic similarity and exploration tilt are ranking context, not coverage authority.

### `3a7e965bcc185b7b42696fc52995813f246e8efa`

- canonical venue-anchor resolution service landed;
- resolved must/soft venue IDs are passed to composition;
- soft anchors boost ranking rather than being forced;
- must-anchor unresolved tracking is wired into composition input/output.

### `a7b841c6517001184c52fbeb7722b818ec34ea65`

- adds venue-anchor resolution tests/hardening;
- also modifies M3.5 provider-rank semantics as documented above.

## Still not equivalent to all of Checkpoint C being complete

At the reviewed implementation HEAD:

- `PlanningCandidateNormalizerService` still does not expose the complete canonical C4/M6 `preferenceWeight` / `mustInclude` contract;
- `must-anchor-placement.util.ts` currently handles unresolved must-anchor translation, but the final planner pinned-placement behavior remains a later responsibility;
- duration-aware reservoir backfill / planner-triggered capacity acquisition is not complete;
- trace v4 / Bitácora v4 remain later milestones.

Therefore the correct state is **M5 PARTIALLY LANDED / IN PROGRESS**, not “M5 not started” and not “all C1-C5 complete”.

---

# Verification semantics

Never infer green tests from this file alone.

Use these labels in future reviews:

- **reviewer-verified**: actually executed/observed during the current review environment;
- **agent-reported**: present in a commit/progress message but not rerun by the reviewer;
- **not verified**: no reliable execution evidence available.

For the 2026-09-14 M3.5 review:

- commit/diff/code inspection: **reviewer-verified via remote GitHub evidence**;
- Nominatim JSONv2 wire contract: **reviewer-verified against official Nominatim API documentation**;
- local backend test execution for `a7b841...`: **not independently verified in this review**;
- earlier M3.5/M4 full-suite numbers: **agent-reported**.

---

# Current execution pointer

1. **Fix the M3.5 JSONv2 `category` → canonical classification mapping.**
2. Add real-wire-shape adapter tests; do not merely update downstream mocks.
3. Re-run targeted M3.5 tests + full backend verification.
4. Review the fix against its parent and re-check remote HEAD before verdict.
5. Only then change M3.5 from BLOCKED to COMPLETE/APPROVED.
6. Preserve already-landed M4/M5 work; do not restart from M2 or undo later milestones.
7. After M3.5 is green, continue reviewing/completing the current M5/M6 frontier from the actual remote HEAD.

## STOP condition

Do **not** mark M3.5 approved, do not rerun RW1, and do not treat the live cutover as complete until the JSONv2 provider-contract blocker above is fixed and verified.
