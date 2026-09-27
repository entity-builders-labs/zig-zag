# RW3/Bitácora defect fixes (F1–F4) + RW2/RW3 canonical reruns — progress & gate report

Date: 2026-09-27. Branch: `feat/preference-first-selection`.
Scope: fix deterministic RW3/Bitácora defects F1–F4, then rerun RW2 and RW3
with the canonical provider pair (Serper grounded search + Cloudflare
discovery extractor). **RW4 not started** (explicit instruction).

## 1. Fixes (commit `b31f5f33`)

- **F1** — anchor resolver classifies destination compatibility:
  `INCOMPATIBLE` candidates are retained only as rejected evidence, are
  never selectable, and are excluded from ambiguity counts. Only
  out-of-destination candidates → honest `DESTINATION_INCOMPATIBLE`
  failure, no silent fallback.
- **F2** — grounded-search provider failures/unavailability surface as
  failed acquisition results carrying provider identity and
  `failureReason`; no more silent zero-evidence "success".
- **F3** — bounded audit-only `candidateFacts` on resolved/unresolved
  anchors (branch, eligibility, decision, compatibility, discovery
  status/reason). No downstream planning behavior depends on them.
- **F4** — bounded diagnostics: destination `boundaryId`/`boundaryName` in
  the resolution trace step; `anchorMode` (`canonical` | `tourism_route`)
  in area/route routing outputs.
- Trace/execution summary now name the actual grounded provider (e.g.
  `serper`) instead of the generic capability label `web`.
- Harness fix: `executionSummary` read from
  `metadata.generationTrace.executionSummary` (canonical persistence
  location), not top-level metadata.

## 2. Verification actually executed

- Focused jest suites green: anchor resolver (37 tests), experience
  acquisition, generation trace builder, execution summary util.
- Tour-generation integration: 99/99 against real Postgres (`zigzag_test`),
  including canonical orchestration with `anchorMode: 'canonical'` for a
  resolved canonical area anchor.
- `eslint` clean; `git diff --check` clean; typecheck shows only the
  pre-existing Nominatim spec `.at()` lib-target errors (unrelated).
- Known pre-existing unit-test failures elsewhere remain (unrelated to
  F1–F4). A `catalog-reuse` integration flake appeared once in a full
  order-dependent run and passed in isolation; not reproduced since.
- Live reruns below (real providers, fresh dedicated DBs).

## 3. RW2 rerun — `spikes/rw2-rerun-serper-cloudflare-2026-09-27`

Verdict: **CHARACTERIZED** (cold+warm `completed`; details in the spike
`assessment.md`).

- Anchors `San Telmo` + `La Boca` resolved as areas; live F3
  `candidateFacts` (`area SELECTED/COMPATIBLE`).
- cold: 14 VERIFIED singleton Experiences, **0 composites** (original
  serpapi+groq run produced the 7-component `San Telmo to La Boca History
  Walk`); portfolio sufficiency never reached; explicit degraded completion;
  `tour_completeness` WARN (`walk` format uncovered).
- warm: **0 new rows** (16/28/14/14 unchanged) — full identity/catalog
  reuse — but coverage FAIL still triggers one bounded reacquisition
  (serper 1 + cloudflare 1); different 5-Experience selection, same WARN.
- Findings: N3 composite synthesis is sensitive to the grounded/classification
  provider pair; N4 warm reruns reacquire while coverage FAILs.

## 4. RW3 rerun — `spikes/rw3-rerun-serper-cloudflare-2026-09-27`

Verdict: **F1–F4 FIXED (live-proven)**; run still **fails closed**
downstream (details in the spike `assessment.md`).

- Caminito resolves as `route` `osm:way:144844726` (route branch
  `SELECTED`, `COMPATIBLE / WITHIN_DESTINATION_BOUNDARY`); the Ezeiza venue
  homonym is `REJECTED_DESTINATION_INCOMPATIBLE`, never selectable, kept as
  rejected evidence. The original deterministic anchor-discard defect is gone.
- Live F3/F4: persisted `candidateFacts`; routing `AREA_ROUTE_WALK=1`,
  `anchorMode: canonical`; destination `boundaryId osm:relation:1224652`.
- F2: serper named in `providersAttempted`, `providersFailed=[]` (no failure
  this run; failure path covered by tests).
- Remaining failure (N1): the single extracted web candidate (`Avenida de
  Mayo to Congreso Walking Route`) was rejected by geographic validation
  (`external_scope_mismatch`); `intent:walk` stayed uncovered → explicit
  fail-closed. Acquisition/extraction does not yet target the resolved
  route corridor. No substitute geometry hand-supplied.

## 5. Engineering-principles completion gate

| Category | Result |
| --- | --- |
| Provider isolation (no provider-name branching in domain logic) | **PASS** — provider identity appears only in adapters/config/diagnostics surfaces |
| Typed canonical contracts (no metadata-bag hidden APIs) | **PASS** — compatibility verdicts, candidateFacts, anchorMode are typed at their boundaries |
| Single policy authority | **PASS** — compatibility/ambiguity decided only in the anchor resolver; no parallel semantics added |
| Unknown / no magic defaults | **PASS** — no invented coordinates/scores; unknown stays unknown; honest failures |
| Dependency direction | **PASS** — utils/trace builders consume domain outputs, not providers |
| Migration cutover / no silent fallback | **PASS** — rejected candidates and coverage failures fail or degrade explicitly |
| Tests speak production contracts | **PASS** — fixtures use production scales/verdicts; harness reads canonical trace location |
| Commit discipline | **PASS** — `b31f5f33` follows subject+bullets with WHY/WHAT/BEHAVIOR/VALIDATION |

## 6. Next (not started here)

- N1: corridor-targeted grounded acquisition for resolved route anchors
  (RW3 end-to-end proof).
- N3: multi-area composite sensitivity to grounded/classification pair.
- RW4 (Mendoza `Ruta del Vino`) — explicitly out of scope until instructed.
