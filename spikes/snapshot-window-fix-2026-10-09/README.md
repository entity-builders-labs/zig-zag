# PF-REV-SNAPSHOT-WINDOW-1 — generation snapshot on the PostGIS boundary (2026-10-09)

Track: `preference-first-selection`. Base HEAD: `a6c79be7`.
Canonical contract:
`docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md`
(§2: "Geographic scope must be resolved by the database before semantic
matching, without a correctness-visible hard cap on the in-scope result
set").

## 1. Root cause (from the review forensic)

The blocker was found by the full Preference-First PR review and reproduced
deterministically by its forensic. That forensic lives at the PR review
boundary and was not committed. The figures below are quoted from it, not
re-derived here.

- Classification: `SUPERSEDED_GLOBAL_SCAN_AUTHORITY`, severity BLOCKER.
- Generation path: `readCatalogSnapshot → findVerifiedWithin` read the
  global VERIFIED rows ordered by id with `take: 1000`, filtered geography
  in JS, then kept the nearest 250.
- Coverage path: `findVerifiedWithinForMatching`, PostGIS `ST_DWithin`,
  with no pre-geography cap.
- With 1000 global rows and the target at position 1000, both coverage and
  the snapshot saw it. With 1001 rows and the target at position 1001,
  coverage saw it and the snapshot did not.
- `lastAcquisitionEpoch = finalCatalogReadEpoch = 1`: the epoch guard
  passed, the target was persisted, and it was absent from the final
  snapshot. The guard was correct; the retrieval authority was incomplete.
- The nearest-250 slice was a second truncation before composition: with
  >250 in-radius rows, coverage saw all of them and generation saw 250.

## 2. Code change

| File | Change |
|---|---|
| `experience-generation.service.ts` | `readCatalogSnapshot` reads `findVerifiedWithinForMatching(lat, lng, radius)`. `CATALOG_RETRIEVAL_POOL_LIMIT = 250` deleted. |
| `experience-catalog.service.ts` | `findVerifiedWithin` deleted. It was the superseded parallel authority (early-stage deletion rule). |
| `tours.controller.ts` | `GET /tours/experiences/nearby` reads the canonical boundary and returns its nearest 100 rows. The 100 is a response page size, not catalog scope. The response no longer carries `distance`; the frontend `ExperienceSearchResult` never read it. |
| `acquisition-audit.ts` | Trace step `catalog.search` names `findVerifiedWithinForMatching` as its component. |

Snapshot flow:

```text
readCatalogSnapshot
→ findVerifiedWithinForMatching   (PostGIS scope, batched hydration, no cap)
→ isTourEligibleForDestinationRequest   (unchanged, separate boundary)
→ explicit-id merge (venue anchors, AREA_ROUTE_WALK ids)   (unchanged)
→ sort by id   (unchanged; PostGIS distance order is discarded)
→ composition / ranking
```

Unchanged: the epoch guard, Gather → Reconcile → Plan, ranking, facets,
duration, walking, dedupe, identity. No acquisition type gets a bypass.
The canonical membership is component-grounded, so a bare Experience with no
resolved component can no longer reach the snapshot (spec §3). No downstream
code read the row `distance` field, which only the deleted path attached.

## 3. Regression tests

New: `be/test/integration/tour-generation/generation-catalog-snapshot.integration-spec.ts`
(real Postgres/PostGIS, real `ExperienceGenerationService` and catalog from
the harness, nothing mocked in retrieval).

| Test | Setup | Proves |
|---|---|---|
| A | 1000 VERIFIED rows 111 km away with ids sorting first, plus an in-radius target with the last-sorting id | snapshot = [target] |
| B | 4 catalog rows (ids sort first), 1001 unrelated rows next, full generation with a PLANNER_CAPACITY refill | refill persisted; final epoch ≥ gather epoch; refill in the FINAL `catalog.snapshot` |
| C | 260 in-radius rows nearer than a target ~2 km out | snapshot holds all 261, by id |
| D | A's and C's rows plus a walk with one component in scope and one 10 km out | snapshot = PostGIS scope ∩ destination eligibility, by id; the walk is in PostGIS scope and excluded only by eligibility |
| explicit | far-away explicit id plus an in-radius row | both in the snapshot |

`bulkSeedFillerExperiences` gained an `idPrefix` option, so the fillers'
place in the global id order is deterministic.

Retargeted tests:
- The unit test that pinned `take: 1000` now proves the PostGIS order
  survives hydration (no quality pre-ranking, no `take`).
- The dimensionedTraits and opening-hours projection tests now read the
  canonical method.
- The gather spec mocks the canonical method and asserts a 3-argument
  (uncapped) call.
- `partial-composite-isolation` checks the single boundary.

## 4. Mutation proof

Each mutation was applied to the working tree and then restored. `shasum -c`
confirmed byte-identical sources after each one.

| Mutation | Killed by |
|---|---|
| M1: both production files restored to `a6c79be7` (global `take: 1000` and nearest 250) | A, B, C, D (4/5 fail). B fails exactly as in the forensic: refill persisted, epoch assertion passed, FINAL snapshot = the 4 seeded rows. |
| M2: new path plus `.slice(0, 250)` before eligibility | C, D |
| M3: destination-eligibility filter removed | D |

## 5. Validation (2026-10-09, run on this tree)

| Command | Result |
|---|---|
| `yarn jest` (unit) | 206 suites, 2937/2937 |
| `yarn test:integration` (`zigzag_test`) | 29 suites, 138/138 |
| `yarn test:e2e` | 41/41 |
| `yarn test:acceptance` | 30/30 |
| `yarn test:characterization` | 35/36: CHAR-7, pre-existing (PF-CHAR7-1) |
| architecture spec (`test/architecture`) | 1/1 |
| `yarn typecheck`, `yarn lint:check`, `prettier --check`, `git diff --check` | clean |
| new spec plus `gather-reconcile-plan` and `catalog-retrieval`, 3 reruns | 15/15 each time; no flake observed |

## 6. Remaining callers and debt

- `findVerifiedWithin`: no callers remain. Historical docs still mention it
  as history.
- Performance: the snapshot now hydrates the whole in-radius pool, which
  coverage already did, and composition scores all of it. With very large
  pools, `getSimilarityScores` binds every id in a single `IN (...)`. That
  is a performance concern, not a correctness cap, and is not measured
  here.
- The INITIAL snapshot keeps its 10 s `withTimeout`. That timeout is
  unchanged and not correctness-visible unless it fires.
