# Gate G-P7-B — BICYCLE calibration — 2026-10-14

OpenSpec change `gap-driven-destination-knowledge`, design "P-D7 preference-first objective" (Modes),
task 33.0 (BICYCLE part). Evidence only: no production code, and the routing architecture is
unchanged. The P11 walk/drive fixtures and the G2 dataset are unchanged.

**Status:**
- **Factual and routing side: RESOLVED.** Recorded BICYCLE evidence exists, is independent of
  WALK/DRIVE, is used only when allowed, and keeps constrained traversal mode-specific.
- **Objective coefficient: RESOLVED (owner, 2026-10-15).** D2 sets c_BICYCLE = 1, and
  `preference-objective-v1` sets A_BICYCLE = 4.5, inside the c_BICYCLE = 1 region 3.2-5.9 (see
  `../g-p7-u-b/README.md`, "Owner decisions and adopted policy").
- **Long rides: RESOLVED by D3.** A resolved hard cycling limit in the PlanningRequest bounds BICYCLE
  travel, with no universal default.
- **Sensitivity.** B-O4 (margin 0.098) is the tightest accepted judgment. A change to bicycle cost or
  friction reruns B-O4, the full judgment suite and the Tour / cross-evaluation set (see
  `../g-p7-u-b/README.md`).
- **Gate G-P7-B overall: CLOSED (2026-10-15).** The 2026-10-14 analysis below is kept as recorded.

## Recorded evidence (`fixtures/*_matrix_bicycle.json`, `scripts/record_bicycle.py`)

- **Provider and call:** Geoapify Route Matrix, `mode=bicycle` ("a city bicycle", default `type`
  balanced, metric).
- **Points:** the same 31 points per city, in the same order, as the recorded P11 walk/drive matrices.
  The script asserts this, so the three modes are directly comparable.
- **Recording:** retrieved 2026-10-14 (UTC timestamps in each file) with latency and an estimated
  credit cost (31 × 10 = 310 credits per matrix, Route Matrix pricing). Recorded once and replayed.
- **API key:** read from the environment; it is not stored in any file (checked).
- **Unavailable pairs:** 0 in every city. In Paris, 60 walking pairs are unavailable (Centre
  Pompidou) while cycling serves them. Availability is per mode, never copied from another mode.

## Factual comparison (`scripts/legs.py` → `runs/legs.json`, solver-free)

| | BA | Paris | LA |
|---|---|---|---|
| bicycle minutes p10 / median / p90 | 5.5 / 16.7 / 56.9 | 4.3 / 9.9 / 17.9 | 13.7 / 39.9 / 70.8 |
| bicycle ÷ walk, p10 / median / p90 | 0.20 / 0.28 / 0.40 | 0.20 / 0.26 / 0.30 | 0.20 / 0.25 / 0.30 |
| bicycle ÷ drive, median | 2.6 | 1.67 | 2.78 |
| pairs where cycling is slower than walking | 3 | 0 | 0 |
| pairs where cycling is faster than driving | 25 | 37 | 2 |

BICYCLE is not a WALK or DRIVE derivative:
- its ratio to walking varies between pairs (0.20-0.40);
- it is slower than walking on some pairs (one-way and network effects) and faster than driving on
  others;
- its unavailable set differs from walking's.

No WALK or DRIVE estimate is reused as a BICYCLE estimate anywhere in this spike.

## Representative legs (choice under the PROPOSED G-P7-U.B check point, c_BICYCLE 0.6 / A_BICYCLE 6, c_DRIVE 1 / A_DRIVE 11)

| leg (BA example; Paris/LA in `runs/legs.json`) | walk / drive / bicycle min | WALK+BICYCLE | WALK+DRIVE+BICYCLE |
|---|---|---|---|
| very short | 6.1 / 1.5 / 3.5 | walk | walk |
| short urban | 12.0 / 1.8 / 3.4 | bicycle | bicycle |
| medium urban | 30.0 / 2.8 / 7.7 | bicycle | bicycle |
| long cross-city | 281.5 / 20.3 / 79.6 | bicycle | drive |
| bicycle faster than drive | 1.1 / 2.8 / 0.2 | walk (very short) | walk |
| walk still sensible | 2.6 / 1.5 / 2.8 | walk | walk |

Share of bicycle choices by walking band (WALK+BICYCLE, all pairs):

| city | ≤ 5 min | 5-10 min | 10-15 min | > 15 min |
|---|---|---|---|---|
| BA | 0 % | 48 % | 100 % | 100 % |
| Paris | 0 % | 89 % | 98 % | 100 % |
| LA | 0 % | 48 % | 100 % | 100 % |

No universal "bicycle wins after N minutes" rule is introduced. The band behaviour follows only from
the per-leg costs, and those costs are owner-dependent.

## Tour-level behaviour (`../g-p7-u-b/runs/tours.json`, check point)

The WALK+BICYCLE, WALK+DRIVE+BICYCLE and BICYCLE-only profiles ran on BA / PA / LA × 4 scenarios.
- **Safety.** 0 hard-constraint violations and 0 forbidden-mode legs. No BICYCLE leg appears in a
  profile without BICYCLE, and no DRIVE leg in WALK+BICYCLE or BICYCLE.
- **WALK+BICYCLE.** Cycling carries most legs (BA 50 of 54 legs, PA 48/57, LA 32/38). Walking keeps
  the very short ones (median 3.6-4.2 min).
- **WALK+DRIVE+BICYCLE.** Paris uses no DRIVE leg (cycling is competitive in a compact city); LA uses
  13 DRIVE legs against 22 BICYCLE legs; BA uses 7 DRIVE against 44 BICYCLE.
- **Long rides.** Single BICYCLE legs reach 59 min (BA) and 54 min (LA). The request contract has no
  cycling limit, so this is owner question D3: a hard request constraint, not an objective weight.

## Constrained TRAVERSE (mode-specific, design C16)

- The G2 evidence (`../../routing-provider-evaluation-2026-10-12/`) shows that the Geoapify and
  Valhalla BICYCLE endpoint routes for San Telmo (Defensa) leave the required segment. Under
  `traversal-validator-v1` they are rejected (coverage 0.008, Hausdorff 194 m). A required walking
  traversal therefore has no valid BICYCLE estimate, and WALK validity is never reused for BICYCLE.
- In the Tour runs, the San Telmo composite (TRAVERSE on foot) is never scheduled in a profile without
  WALK. Its traversal is CONSTRAINT_UNSATISFIED for every allowed mode, which gives the typed reason
  REQUIRED_TRAVERSAL_UNSATISFIED. With WALK allowed, its internal timeline keeps the recorded walking
  time.

## Acceptance (G-P7-B)

| # | criterion | status |
|---|---|---|
| 1 | recorded bicycle evidence exists | yes (3 matrices, 0 unavailable pairs) |
| 2 | bicycle chosen only when allowed | yes (0 forbidden-mode legs in 732 runs) |
| 3 | no WALK/DRIVE estimate reused for BICYCLE | yes (ratios vary; separate availability) |
| 4 | bicycle cost compatible with the G-P7-U.B policy | yes as a form (c_BICYCLE per minute + A_BICYCLE per leg, no city value); the value is OPEN (owner D2, judgments B-O1…B-O5) |
| 5 | sensible across BA/Paris/LA | yes at the check point; long rides pending D3 |
| 6 | no destination-specific coefficient | yes |
| 7 | constrained traversal semantics valid | yes (mode-specific; composite never bicycle-timed) |
| 8 | representative mixed-mode scenarios pass | yes (0 violations, identical repeats) |

Criteria 4 and 5 kept G-P7-B OPEN until G-P7-U.B and owner questions D2 and D3 were answered. They
were answered on 2026-10-15: criterion 4 is c_BICYCLE 1 / A_BICYCLE 4.5, and criterion 5's long rides are
bounded by the D3 cycling limit. At the adopted policy, WALK+DRIVE+BICYCLE uses 0 DRIVE legs in Paris,
16 DRIVE vs 36 BICYCLE in BA and 25 vs 11 in LA, with 0 violations. G-P7-B is CLOSED.
