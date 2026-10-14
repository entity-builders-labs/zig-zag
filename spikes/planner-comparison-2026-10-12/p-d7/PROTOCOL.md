# P-D7 objective calibration — pre-registered protocol (2026-10-13)

Written before any calibration run. OpenSpec change `gap-driven-destination-knowledge`, design P-D7,
task 24.2. Fixed inputs: P11 fixtures (`../fixtures/`, BA / Paris / LA, recorded Geoapify walk + drive
matrices; no live routing), P-D5 optimizer = OR-Tools Routing 9.15.6755 through the G-P5 adapter
(`../g-p5/sidecar/adapter.py`, imported read-only, unchanged), stop policy `routing-gls-sl1000-v1`.
Hard constraints (opening hours, day windows, must-include, allowed modes, walking limits, routing
availability, composite internal feasibility) stay hard and are never weighted.

## Scope

- Modes: the request's `allowedTravelModes` is the outer hard boundary; the objective only compares
  allowed modes with estimates. Calibrated: WALK and DRIVE (recorded). BICYCLE: no recorded bicycle
  matrices in the fixtures and no routing key in this worktree → not calibrated (gate). TRANSIT: no
  matrix-capable provider in the first release (P-D1) → feature-gated, not calibrated.
- Walking limits as in P11 (30 min continuous, 150 min/day) for comparability.
- Out of scope: personalization, TourStop, LLM desirability, destination-specific weights, transit
  providers.

## Objective structure (candidate)

Unit = **travel-minute equivalent (tme)**: one minute of walking costs 1 (numéraire).

```text
TourUtility = Σ_selected K · u_i · (1 − ρ · f_i)          desirabilityReward with uncertainty discount
            − Σ_walk legs  minutes                         WALK travel cost
            − Σ_drive legs (c_d · minutes + A)             DRIVE travel cost + activation cost
```

- `u_i` ∈ (0, 1]: ranking desirability normalized per request so the top candidate = 1 (the fixtures
  are already max-normalized per city; the normalization is made explicit and versioned).
- `K`: tme a top Experience (u = 1) is worth — "how much extra travel a top Experience justifies".
- `c_d`: cost of a driving minute relative to a walking minute; `A`: fixed tme per DRIVE leg.
- `f_i` = uncertain VISIT components / VISIT components; `ρ` relative uncertainty discount. Alternative
  tested: absolute penalty `P` tme per uncertain VISIT component (the P-D4 symbolic form).
- Terms not added unless a measured problem requires them: idle, day balance, count reward,
  clustering, diversity.

P11 test weights in these units: K = 100, c_d = 2, A = 10, P = 10 (absolute), for reference only.

## Profiles

A = [WALK]; B = [WALK, DRIVE]; C = [DRIVE] (the DTO accepts DRIVE-only; door-to-door drive times, no
walking access modelled — documented, not invented). D (BICYCLE) and TRANSIT: not run.

## Scenarios (each city; from P11 `run_all.scenarios`)

S1 normal 3-day ~30 pool (includes BA composite; UNKNOWN hours present: BA 15/29, PA 21/30, LA 15/30),
S2 tight hours, S5 1-day oversupply, S9 start+end anchors (pool 20), S4 must-include.
Profile A also runs S6-like 1-day walk-only implicitly (S5 with WALK).

## Stages and grids (coarse → fine, bounded)

1. **Arc-level mode choice (solver-free).** For every candidate pair with both a walk (≤ 30 min) and a
   drive estimate: mode chosen = argmin(walk, c_d·drive + A). Structures: S-A (c_d = 1, A ∈ {0, 2, 5,
   10, 15, 20}) and S-C (A = 0, c_d ∈ {1, 2, 3, 4, 6}). Report the short-hop rate and the drive share
   per walk-duration band.
2. **K sweep** (Tours, profiles A and B, provisional mode parameters from stage 1): K ∈ {15, 30, 60,
   120, 240, 480, 960} then a fine grid around the selected value.
3. **Drive activation** at the selected K: A = 0 vs the stage-1 candidates (Tour-level).
4. **Uncertainty**: ρ ∈ {0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8} and P ∈ {0, 5, 10, 20, 40, 80} tme.
5. **Sensitivity** of the final candidate: each parameter ×0.5, ×0.75, ×1.5, ×2 one at a time.
6. **Solver check**: final policy on all scenarios × profiles, 3 repeats, SL1000 (identity, cap hits,
   solve time).

## Metrics (per run)

Selected Experiences, Σu (desirability captured), scheduled count, WALK minutes, DRIVE minutes, DRIVE
legs, short-hop DRIVE legs (walking alternative ≤ 10 min), UNKNOWN-hour visits, attractive omitted
(unscheduled with u ≥ the median selected u), objective, solve ms, stop reason, validity (independent
validator: windows, travel consistency, allowed modes only, walking limits), forbidden-mode legs.

## Pre-registered criteria

- **Validity gate**: 0 hard-constraint violations and 0 forbidden-mode legs in every run.
- **Short-hop criterion** (mode): DRIVE legs whose walking alternative is ≤ 10 min (the conventional
  5-10 minute "pedestrian shed" of transport planning) should not appear; WALK must not be forced when
  the walk exceeds the continuous limit (that is already hard).
- **Mode balance**: neither mode globally dominant: in the 15-30 min walk band both modes occur across
  cities under profile B.
- **K selection (knee)**: Σu(K) relative to the travel-indifferent reference Σu(K = 960). Select the
  smallest grid K whose mean retention across profile A/B scenarios is ≥ 98 % and worst scenario
  ≥ 95 %, then confirm that travel is materially lower than at K = 960 (otherwise travel cost is not
  doing work). Retention thresholds are fixed here, before any run.
- **Drive activation**: retain A > 0 only if A = 0 produces short-hop DRIVE legs or more DRIVE legs
  without a desirability gain; if retained, choose the smallest grid A that removes short hops, then
  check stability (sensitivity).
- **Uncertainty**: non-pathological = UNKNOWN visits ≥ 80 % of the ρ = 0 / P = 0 count AND no
  attractive UNKNOWN candidate (u ≥ p75 of the pool) dropped relative to the zero-penalty run in any
  scenario AND must-include UNKNOWN kept. Choose a value inside the non-pathological region that
  still makes comparable known items win (analytic twin rule: known wins iff u_U·(1−ρ) < u_K).
  Prefer the form (relative / absolute) without a suppression boundary.
- **Cross-city**: one policy; if a city behaves pathologically, revisit normalization, not per-city
  weights.
- **Sensitivity**: a parameter is acceptable if ×0.75 and ×1.5 keep the criteria; near-tie regions
  and pathological boundaries are reported.
- **Solver**: SL1000 keeps identical repeats and no safety-cap hits on the benchmark cases;
  otherwise report (do not change P-D5).
