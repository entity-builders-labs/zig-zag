# P-D7 — experimental objective calibration (NON-PRODUCTION) — 2026-10-13

> **Status: experimental evidence only. Not production policy.** The owner rejected promoting the numbers
> below (K = 120, +10 per DRIVE leg, 10 % UNKNOWN-hours discount) as product semantics (2026-10-14): they
> were fitted on a generic, destination-wide desirability signal, not on the user's preference
> satisfaction. P-D7 is reframed as a preference-first objective in design.md ("P-D7 preference-first
> objective"); production coefficients belong to gate G-P7-U. What this spike does support is recorded
> there: one objective structure behaves across BA / Paris / LA; travel burden matters; minutes-only
> DRIVE cost produces pervasive car hops (a per-leg mode-friction concept is needed); an absolute
> UNKNOWN-hours cost has a suppression boundary that a cost relative to utility does not; idle,
> day-balance, count, clustering and diversity terms were unnecessary; allowed modes are respected as
> hard constraints; and single-start GLS at SL1000 has a measurable search gap.

OpenSpec change `gap-driven-destination-knowledge`, design P-D7 / P8 / P9, task 24.11. Evidence only: no
production code, no Prisma change, P-D5 unchanged (OR-Tools Routing, `routing-gls-sl1000-v1`, through the
unchanged G-P5 adapter imported read-only). Historical evidence (`../README.md`, `../g-p5/`) unchanged.
Protocol written before any run: `PROTOCOL.md` (deviations recorded below).

Experimental objective evaluated (name `exp-objective-2026-10-13`; the run files call the final candidate
`final` / `planner-objective-v1` — that label is superseded and must not be used as a production version):

```text
unit: travel-minute equivalent (tme); 1 walking minute = 1 tme      (EXPERIMENTAL)
TourUtility = Σ_scheduled 120 · u_i · (1 − 0.1 · f_i)        u_i = fixture desirability / pool max (generic, not preference-based)
            − Σ_WALK legs   1 · minutes
            − Σ_DRIVE legs (1 · minutes + 10)
f_i = uncertain VISIT components / VISIT components of Experience i
```

## Layout

| Path | What |
|---|---|
| `PROTOCOL.md` | pre-registered structure, grids, criteria |
| `scripts/calib.py` | request builder (objective → planning-problem-v1), independent validator, scorer, parallel runner |
| `scripts/stage1_arcs.py` | solver-free per-arc mode analysis + raw distributions |
| `scripts/stages.py` | stages 2-6 (K sweep, drive structure, uncertainty, sensitivity, solver budget, final) |
| `scripts/analyze.py`, `modes.py`, `unknown.py`, `crosseval.py`, `bestknown.py`, `swaps.py`, `solvergap.py` | summaries, search-noise separation, solver gap |
| `scripts/must_unknown.py`, `examples.py` | must-include UNKNOWN check; tradeoff examples and representative Tours |
| `runs/` | every raw run (`stage*.json`: per run params, selected Experiences, Σu, minutes per mode, legs, short hops, UNKNOWN visits, omitted candidates, solve ms, stop reason, violations, repeat identity) and summaries |

Reproduce: Python 3.14 + `ortools==9.15.6755` (`../g-p5/sidecar/requirements.txt`), `python -I
scripts/stage1_arcs.py`, `python -I scripts/stages.py <stage> '<params json>'` (parameters as recorded in
each run file's `meta.params`). Runs are parallel processes; the count-based stop makes them deterministic
(`identicalRepeats`).

## Travel modes (hard boundary, not an objective choice)

- `allowedTravelModes` from the request (wizard → `MobilityPreferencesDto.allowedTransportationModes`, any
  non-empty subset of walking / driving / cycling / public_transport) is the outer hard boundary. The
  optimizer receives travel estimates only for allowed modes that the release supports and the routing
  provider serves; the objective only ranks those. No weight can make a forbidden mode usable (measured:
  0 forbidden-mode legs and 0 hard-constraint violations in 1,567 independently validated planned runs
  across all stages; no WALK-only run contains a DRIVE leg).
- First release, calibrated: **WALK, DRIVE**.
- **TRANSIT**: feature-gated in v1 (no matrix-capable provider in P-D1). Never estimated, never substituted.
  WALK + TRANSIT plans with WALK and records TRANSIT as MODE_UNAVAILABLE (existing partial-availability
  rule); TRANSIT only → no usable mode → the existing TRAVEL_ESTIMATION_UNAVAILABLE outcome with
  MODE_UNAVAILABLE, no Tour, no acquisition, no substitute mode.
- **BICYCLE**: a confirmed first-release mode (P-D1 G0); Geoapify serves it and the wizard offers it, but
  the fixtures contain no recorded bicycle matrices and this worktree has no routing key, so its cost
  cannot be calibrated here without inventing data. P-D7 does not invent an interim BICYCLE weight or an
  interim product behaviour: gate G-P7-U calibrates it before first-release wiring (group 41).
- DRIVE-only (profile C) is a valid request today; drive estimates are door-to-door, no walking access is
  modelled or invented.
- Finding outside P-D7: user walking limits are distances (`maxWalkingDistancePerDayMeters`,
  `maxContinuousWalkingDistanceMeters`); the calibration uses the P11 minute limits (30 / 150) for
  comparability. The limits stay hard constraints; how distances map to the planner's walking dimension
  belongs to group 25/26.

## Natural scales (`runs/distributions.json`)

| | BA | Paris | LA |
|---|---|---|---|
| desirability min / median / max | 0.40 / 0.71 / 1.0 (spike 3 semanticScore) | 0.71 / 0.77 / 1.0 (log sitelinks) | 0.41 / 0.61 / 1.0 (log sitelinks) |
| walk minutes p10 / median / p90 between candidates | 17 / 59 / 212 | 16 / 39 / 69 | 50 / 163 / 288 |
| share of candidate pairs walkable ≤ 10 / ≤ 30 min | 4 % / 24 % | 4 % / 33 % | 4 % / 9 % |
| drive minutes p10 / median / p90 | 3.0 / 6.7 / 15.5 | 2.9 / 6.3 / 10.7 | 5.8 / 13.4 / 22.1 |
| walk ÷ drive (median) | 9.6 | 6.5 | 11.1 |
| UNKNOWN-hours candidates | 15/29 | 21/30 | 15/30 |
| final Tours: Experiences per run median (range) | 19 (8-27) | 20 (9-28) | 14 (1-22) |
| final Tours: travel per day median / max (min) | 20.5 / 126 | 17.3 / 148 | 9.2 / 100 |
| final Tours: UNKNOWN visits per run median | 9 | 15 | 6 |

Normalization: desirability sources differ in spread (Paris is compressed), but all are already
max-normalized per city; making that explicit per request (`request-max-v1`) keeps K interpretable as
"travel worth a top Experience". A rank or min-max transform was not needed: one K behaves across the
compressed (Paris) and spread (BA, LA) distributions (cross-city below). Travel needs no normalization:
minutes are already a common physical unit.

## Calibration method (coarse → fine, `PROTOCOL.md`)

Profiles A = [WALK], B = [WALK, DRIVE], C = [DRIVE]; scenarios per city: normal 3-day (~30 pool, BA
composite), tight hours, 1-day oversupply, start+end hotel anchors, must-include (+ normal 20-pool, start
anchor, UNKNOWN weight 0 in the final run). Every plan validated independently (windows, travel
consistency, allowed modes, walking limits, must-include): **0 violations in every stage**.

Stage 1 — mode structure (solver-free, every walkable pair, `runs/stage1_arcs.json`):

| structure | short-hop DRIVE (walk ≤ 10 min) BA / PA / LA | drive share by walk band 10-15 / 15-20 / 20-30 (BA) |
|---|---|---|
| minutes only, c_d = 1, A = 0 | 97 % / 86 % / 100 % | 100 / 100 / 100 % |
| minutes only, c_d = 6, A = 0 | 19 % / 55 % / 44 % | 29 / 33 / 42-67 % |
| c_d = 1, A = 5 | 41 % / 59 % / 47 % | 97 / 100 / 100 % |
| **c_d = 1, A = 10** | **0 / 0 / 0 %** | 37 / 98 / 100 % |
| c_d = 1, A = 20 | 0 / 0 / 0 % | 0 / 0 / 17-96 % |

A per-minute DRIVE weight alone cannot stop pointless car hops (a 5-min walk is still a 1-2 min drive):
the fixed activation cost is structurally necessary.

Stage 2 — desirability vs travel (`runs/stage2_K*.json`; retention = Σu vs the travel-indifferent K = 960):

| K (tme per u = 1) | Σu retention mean / worst | travel vs K960 | DRIVE legs | note |
|---|---|---|---|---|
| 15 | 59.7 % / 0 % | 0.45 | 31 | refuses most travel |
| 30 | 91.9 % / 0 % | 0.82 | 113 | LA anchored walk-only: 0 visits |
| 60 | 96.5 % / 0 % | 0.88 | 147 | same |
| 70 | 97.3 % / 0 % | 0.91 | 153 | same |
| 80-110 | 99.9-100.5 % / 95.2-96.3 % | 0.91-0.95 | 153-156 | passes, close to the boundary |
| **120** | **100.9 % / 99.1 %** | 0.96 | 158 | selected |
| 150-480 | 100.0-100.3 % / 98.1-99.8 % | 0.95-0.98 | 158-172 | plateau |
| 960 | 100 % / 100 % | 1.00 | 177 | reference |

Above ~120 desirability is flat while travel and DRIVE legs keep rising; below ~80 the planner refuses
worthwhile visits. K = 120 is the smallest coarse value meeting the pre-registered retention rule whose
×0.75 neighbour (90) also meets it.

Stage 3 — DRIVE activation at the Tour level (profile B, `runs/stage3_drive*.json`):

| policy | short hops | walk / drive legs | Σu worst retention | travel vs A10 |
|---|---|---|---|---|
| A = 0 | 52 | 1 / 246 | 96.3 % | 0.72 |
| c_d = 2 / 3 / 4, A = 0 | 56 / 54 / 40 | 6-35 / 211-242 | 94.1-96.3 % | 0.64-0.70 |
| A = 7 / 8 | 11 / 2 | 53-70 / 178-194 | 95.5-99.0 % | 0.79-0.91 |
| **A = 9 / 10 / 11** | **0** | 81-96 / 151-167 | 96.4-100 % | 0.97-1.05 |
| A = 12 / 13 / 15 / 20 | 0 | 111-142 / 104-134 | 92.9 % (LA 1-day oversupply) | 1.17-1.48 |

Retained: A = 10 tme per DRIVE leg — below it car hops return, above it walking displaces visits. It is an
objective preference (pick-up / parking / access friction and avoiding car hops), not a physical duration
and not added to any travel estimate. c_d = 1: a minute is a minute; the sensitivity below shows c_d is not
critical (×0.5-×2 all pass), so the simplest value is kept.

Stage 4 — UNKNOWN hours (`runs/stage4_unknown*.json`): relative discount ρ ∈ {0 … 0.8} vs absolute P ∈
{5 … 80} tme per uncertain VISIT component.

| policy | UNKNOWN visits (best-known plans) | worst Σu retention (best-known) | behaviour |
|---|---|---|---|
| ρ 0 | 281 (100 %) | 100 % | reference |
| ρ 0.05 / P 5 | 273 (97 %) | 96.9 % | swaps near-ties toward known hours |
| **ρ 0.1** | 269 (96 %) | 96.9 % | selected |
| ρ 0.2 / P 20 | 261 (93 %) | 96.9 % | still stable |
| ρ 0.3 | 254 (90 %) | 93.3 % | degrading |
| ρ 0.5 / P 40 | 228-238 (81-85 %) | 0 % (LA anchored walk-only) | pathological |
| ρ 0.8 / P 80 | 137-177 (49-63 %) | 0 % | pathological |

Every newly dropped attractive UNKNOWN item was replaced by KNOWN-hours items (`runs/stage4_unknown_swaps.json`):
LA 0.871 → 0.855 (comparable), and tour-level near-ties where the alternative Tours differed by less than the
penalty (BA 1-day walk-only 0.978 → 0.800 + 0.778). The relative form was chosen: same behaviour as the
absolute form at these values, but no "value < penalty ⇒ never selected" boundary for low-utility items and
no dependence on the K scale. Must-include UNKNOWN items stay scheduled at ρ = 0.1 and ρ = 0.8 in all
cities and profiles (`runs/must_unknown.json`, 12/12).

## Sensitivity of the final policy (`runs/stage5_sensitivity*.json`)

| parameter | ×0.5 | ×0.75 | ×1.5 | ×2 | stable range |
|---|---|---|---|---|---|
| K = 120 | LA anchored walk-only 0 visits | 95.9 % worst | 98.9 % | 95.7 % | ≈ 80 … ≥ 960 (pathological ≤ 70) |
| A = 10 | 18 short hops | 14 short hops | 0 hops, 95.5 % worst, travel +14 % | 0 hops, 95.5 %, travel +21 % | 9 … 11 strict; lower edge = the 10-minute walking threshold by construction |
| c_d = 1 | 96.9 % | 97.8 % | 98.5 % | 98.3 % | ≥ 0.5 … 2 (not critical) |
| ρ = 0.1 | 99.5 % | 99.8 % | 99.2 % (best-known) | 98.6 % (best-known) | 0 … 0.2; pathological ≥ 0.5 |

Near-tie regions: A's lower edge (short hops reappear just below 9-10) and tour-level near-ties under ρ;
neither is a weight chosen to flip one example. A is the narrowest parameter: it is a semantic threshold
("walk when it costs at most 10 extra minutes"), tied to the conventional 5-10 minute walking catchment,
with measured failure on both sides.

## Profiles and cross-city behaviour (final policy, `runs/stage6_final.json`, 72 runs × 3 repeats)

| profile | DRIVE legs | WALK legs | short hops | forbidden-mode legs | repeats identical |
|---|---|---|---|---|---|
| A WALK-only | 0 | 272 | – | 0 | 24/24 |
| B WALK+DRIVE | 261 | 163 | 0 | 0 | 24/24 |
| C DRIVE-only | 424 | 0 | n/a (walking not allowed) | 0 | 24/24 |

Representative Tours (`runs/representative_tours.json`), normal 3-day:

| city | WALK-only | WALK+DRIVE | DRIVE-only |
|---|---|---|---|
| BA | 18 Experiences, Σu 13.6, walk 149 min | 27, Σu 18.9, walk 95 + drive 53 min, 12 drive legs | 27, Σu 19.1, drive 92 min |
| Paris | 26, Σu 20.6, walk 265 min | 28, Σu 22.2, walk 86 + drive 39 min, 13 drive legs | 28, Σu 22.2, drive 55 min |
| LA | 10, Σu 5.8, walk 37 min | 22, Σu 14.7, walk 28 + drive 115 min, 14 drive legs | 22, Σu 14.9, drive 152 min |

One policy, no city-specific weights: compact Paris walks most legs when driving is allowed, dispersed LA
drives most, BA mixes. WALK-only plans are bounded by the walking limits (LA keeps 10 Experiences; anchored
LA walk-only finds 1 — the hotel is far from everything walkable).

Tradeoff examples (`runs/examples.json`):
- *Isolated, desirable*: Santa Monica Pier (u 0.65, median 22 min drive to the others) is excluded at K = 30
  and included at K = 120 when driving is allowed; the Getty (u 0.86, 22 min) is included with DRIVE and
  never walk-only (walking limits).
- *Refusing worthwhile travel*: LA anchored, K = 30 → 0 visits (walk) / 12 (walk+drive) vs 1 / 20 at K = 120.
- *Excess travel*: K = 960 adds 15-40 travel minutes for equal or lower Σu (LA 1-day: chases a far Experience
  and ends with one fewer).

## Solver interaction (`routing-gls-sl1000-v1`, P-D5 unchanged)

- Repeats identical 72/72; stop reason SOLUTION_LIMIT on every planned run; no safety-cap hit; solve time
  median 2.0-2.7 s, max 4.4 s per profile while 8 runs shared the laptop.
- Finding: under the calibrated objective, SL1000's plan equals the best plan found by any policy in 7/28
  scenarios and is > 1 % below it in 13 (max 8.7 %, mostly walk-only and 1-day oversupply). Larger budgets
  barely help (SL2000 12, SL5000 12, SL10000 9 scenarios > 1 %; 18 s median at SL10000) and the same pattern
  exists under the P11 weights (7/35 scenarios > 1 % below the best of the G-P5 policies, max 8.5 %). It is a
  property of single-start GLS, not of these weights and not fixed by budget. All P-D7 comparisons were
  therefore also made on best-known plans (cross-evaluation), so the weights do not chase search noise.
  Reported for P-D5 follow-up (e.g. multi-start / alternative first-solution strategies under the same
  count-based determinism); P-D5's stop policy is not changed here.

## Rejected alternatives

- Minutes-only DRIVE cost (any c_d, A = 0): car hops (40-56 per profile-B batch).
- A ≥ 12: walking displaces visits (worst retention 92.9 %).
- K ≤ 70: refuses worthwhile travel (0 visits in anchored LA walk-only); K ≥ 240: more travel and DRIVE legs
  for no desirability.
- Absolute UNKNOWN penalty: equivalent at small values, but suppression boundary for low-utility items and
  coupling to K; ρ ≥ 0.5 / P ≥ 40: pathological suppression.
- Idle, day-balance, count, clustering, diversity terms: no measured problem (travel cost already yields
  compact days; P11 showed none needed).
- City-specific weights, rank normalization, lexicographic objectives: not needed.
- The P11 test weights (K 100, c_d 2, A 10, P 10): never promoted; they differ mainly in c_d = 2 (drives
  less) and the absolute penalty.

## Protocol deviations

1. Stage-4 criterion "no attractive UNKNOWN newly dropped" conflicts with P-D4's intent (prefer known hours
   when comparable): every positive penalty swaps some comparable or near-tied UNKNOWN item for a KNOWN one.
   Decided on the measured suppression boundary (UNKNOWN share ≥ 80 %, worst best-known retention) and the
   swap inspection instead; both tables are reported.
2. Search noise: comparisons that the pre-registration assumed to be objective effects were partly SL1000
   search artefacts (cross-evaluation). Best-known evaluation was added; the direct-run tables are kept.
3. Profile D (BICYCLE) not run: no recorded bicycle data (now part of gate G-P7-U).

## BICYCLE (folded into gate G-P7-U)

Profile D was not run (no recorded bicycle data). Bicycle is a confirmed first-release mode (P-D1 G0); its
travel burden and any mode friction are calibrated inside the single preference-utility gate G-P7-U
(design), with one recorded bicycle matrix per fixture city replayed — no interim weight is invented.

## Superseded implementation note

The earlier note proposing these coefficients as the production contract is withdrawn. The production
planning contract carries a preference-first, policy-versioned utility derived upstream of the optimizer
(design "P-D7 preference-first objective"); its coefficients come from gate G-P7-U.
