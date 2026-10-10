# RW3/Bitácora defect fixes (F1–F4) + RW2/RW3 canonical reruns — progress & gate report

> **Status of this file: SUPPORTING EVIDENCE, not an execution pointer.** The
> current execution pointer is
> `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`.
> Post-hoc corrections (2026-09-27 review of `d1115a3b`): F2 was
> deterministic-test-proven, not live-proven (no provider failure occurred);
> the RW2 composite delta is at the Serper evidence → Cloudflare extraction
> boundary (0 extracted web candidates before classification) and its cause
> is unisolated; RW3 N1 was a lost typed anchor at the search → extractor
> handoff, not missing query targeting; the rejected Ezeiza homonym was never
> persisted; RW2 rerun used 5000/3000 m, not the 50000/20000 control. Follow-up
> fixes and the next RW3 rerun: commit `d6149363` and
> `spikes/rw3-anchor-handoff-rerun-2026-09-27/`.

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
- Findings (N3 corrected): multi-area composite recovery was not reproduced
  under the Serper→Cloudflare evidence/extraction boundary — Serper returned
  9 applied items (incl. *Private La Boca & San Telmo Walking Tour*, *Guide
  to visiting San Telmo & La Boca on foot*) and Cloudflare extracted 0 web
  candidates, before classification, so classification cannot explain it;
  Serper-bundle vs Cloudflare-context cause is unisolated. N4 warm reruns
  reacquire while coverage FAILs.
- Mobility-control deviation: this rerun executed with `5000 / 3000` m, not
  the intended non-binding `50000 / 20000`; it does not affect the
  extraction result (no multi-component candidate emitted).

## 4. RW3 rerun — `spikes/rw3-rerun-serper-cloudflare-2026-09-27`

Verdict (corrected): **F1, F3, F4 live-proven; F2 deterministic-test-proven**
(successful provider identity live-proven; failure path not live-triggered);
run still **fails closed** downstream (details in the spike `assessment.md`).

- Caminito resolves as `route` `osm:way:144844726` (route branch
  `SELECTED`, `COMPATIBLE / WITHIN_DESTINATION_BOUNDARY`); the Ezeiza venue
  homonym is `REJECTED_DESTINATION_INCOMPATIBLE`, never selectable, kept only
  as Bitácora `candidateFacts` audit evidence (not persisted). The original
  deterministic anchor-discard defect is gone for this cross-branch case.
- Live F3/F4: persisted `candidateFacts`; routing `AREA_ROUTE_WALK=1`,
  `anchorMode: canonical`; destination `boundaryId osm:relation:1224652`.
- F2: serper named in `providersAttempted`, `providersFailed=[]` (no failure
  this run; failure path covered by tests).
- Remaining failure (N1, corrected): the single extracted web candidate
  (`Avenida de Mayo to Congreso Walking Route`, from `ev-7`) was rejected by
  geographic validation (`external_scope_mismatch`); `intent:walk` stayed
  uncovered → explicit fail-closed. The query already contained Caminito and
  Serper returned Caminito/La Boca results; the typed `anchorNames` reached
  search but were dropped from the extractor request. No substitute geometry
  hand-supplied.

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

- N1: done in `d6149363` (typed anchor handoff to the extractor) and
  re-tested live in `spikes/rw3-anchor-handoff-rerun-2026-09-27/`.
- N3: frozen-corpus investigation of the Serper-evidence → Cloudflare
  extraction boundary for multi-area walks (future; not RW3).
- RW4 (Mendoza `Ruta del Vino`) — explicitly out of scope until instructed.
