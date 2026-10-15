# Gate G-P7-U part B — preference utility vs travel, mode friction and uncertainty — 2026-10-14

OpenSpec change `gap-driven-destination-knowledge`, design "P-D7 preference-first objective", task 33.0.
Evidence only: no production code. P-D5 is unchanged (OR-Tools Routing, `routing-gls-sl1000-v1`, the
G-P5 adapter imported read-only). G-P7-U.A semantics are unchanged and no number is borrowed back
into A.

**Status (owner, 2026-10-15): G-P7-U.B RESOLVED, P-D7 RESOLVED.** The owner accepted the 25 PROPOSED
judgments as the initial, versioned judgment set and answered D1-D4 (see "Owner decisions and adopted
policy"). The adopted objective policy is `preference-objective-v1`, an EVIDENCE_BACKED_INITIAL_POLICY,
not a universal optimum. The analysis below is the 2026-10-14 record that led to it.

The structure of B is resolved by evidence:
- one cardinal prize per Experience, built from A's stated quantities;
- additive Tour satisfaction;
- per-mode travel cost plus per-leg vehicle friction;
- a relative UNKNOWN-hours cost.

Its coefficients are not. Accepted semantics alone leave every coefficient effectively unbounded
(the DERIVED-only regions below span 20× to 170×), so the numbers depend on product judgments that
nobody has confirmed yet. Under this run's PROPOSED judgments, a non-trivial region exists and is
stable across BA / Paris / LA with zero hard-constraint violations. Those judgments are proposals,
not ground truth.

## Layout

| Path | What |
|---|---|
| `scripts/judgments.py` | pairwise Tour judgments → inequalities → feasible regions (grid enumeration, no fitting) → `runs/judgments.json` |
| `scripts/tours.py` | OR-Tools validation on BA/PA/LA × 4 scenarios × 5 mode profiles at the check point and ×0.75 / ×1.33 perturbations → `runs/tours.json` (732 runs) |
| `scripts/analyze.py`, `scripts/crosseval.py` | safety, cross-city, stability → `runs/tours_summary.json`; best-known cross-evaluation → `runs/crosseval.json` |
| `runs/*_adopted.json` | the same three scripts at the owner-adopted policy (`GP7UB_POINT=adopted`); `runs/judgments.json` → `adoptedPoint` |

Reproduce with Python 3.14 and `ortools==9.15.6755` (`../g-p5/sidecar/requirements.txt`):
`python -I scripts/judgments.py` (OR-Tools not needed), then `python -I scripts/tours.py`,
`python -I scripts/analyze.py`, `python -I scripts/crosseval.py`. Prefix the last three with
`GP7UB_POINT=adopted` to reproduce the adopted-policy runs; without it they reproduce the 2026-10-14
check-point runs unchanged. The BICYCLE matrices are in
`../g-p7-b/fixtures/`.

## Protocol

1. **Judgments first.** Each judgment compares Tour A with Tour B for the same request, where only one
   tradeoff differs. The expected answer (always "A preferred") and its source are written before any
   parameter is examined:
   - **DERIVED** — follows from an accepted rule (G-P7-U.A precedence and monotonicity, P-D4, "less
     travel at equal satisfaction");
   - **PROPOSED** — a human-quality rationale written in this run. It needs owner confirmation and is
     never treated as ground truth.
2. **Inequalities.** Each judgment becomes `lhs > rhs` over the parameters, with both sides
   non-negative.
3. **Regions.** Log-spaced grids are enumerated for each parameter group. A grid point is kept when
   every judgment in the set holds. The script reports:
   - interval projections, flagging projections cut off by the grid edge (effectively unbounded);
   - the point with the largest minimum `log(lhs / rhs)`.

   No objective is optimized against fixtures.
4. **Check point.** A simple rounded point inside every region. All 32 judgments hold there, and each
   parameter is perturbed ×0.75 / ×1.33.
5. **Tour validation.** OR-Tools runs on the recorded fixtures:
   - every plan checked by the independent P-D7 validator;
   - best-known cross-evaluation to separate objective effects from single-start GLS noise.

## Objective family under test

```text
unit: tme (travel-minute equivalent); 1 walking minute = 1 tme
TourUtility = Σ_scheduled p_i · (1 − ρ·f_i)  −  Σ_legs (c_mode · minutes + A_mode)
p_i = K · v_i / max_j v_j        v_i = D_i + β·I_i + γ·r_i
  D_i  Σ stated importance of matched DIRECT facets (live mapping: strong 1.0 / medium 0.7 / weak 0.5)
  I_i  Σ importance × confidence of matched INFERRED facets
  r_i  ∈ [0, 1] within-request refinement position (soft anchor → semantic → quality; A's order)
  f_i  uncertain / total VISIT components (P-D4)
c_WALK = 1, A_WALK = 0; c_DRIVE, A_DRIVE, c_BICYCLE, A_BICYCLE; provider durations are never modified
```

## Structural findings (independent of the owner answers)

1. **A prize per Experience is required.** Routing's objective is per-node disjunction penalties plus
   arc costs, and it has no lexicographic or multi-objective mode. Tiers could be forced in two ways,
   both rejected:
   - *Mixed-radix prizes* would make one `DIRECT` match outweigh any number of `INFERRED` matches and
     any amount of travel. Nobody has stated that as product behaviour, and it would make travel
     irrelevant whenever a `DIRECT` match exists.
   - *Sequential lexicographic solves* would need cardinality side constraints that the G-P5 model
     does not have, and multiply solve time.
2. **Tour-level satisfaction is the sum of the prizes.** A separable objective is what Routing
   optimizes. Non-separable satisfaction (diminishing returns per facet, coverage) cannot be expressed
   in it. Facet coverage stays the composition's job (one reserved strongest match per requested
   facet, G-P7-U.A), upstream of the optimizer.
3. **Smallest faithful cardinalization.**
   - The prize comes from A's own stated quantities: `DIRECT` importance and `INFERRED`
     importance × confidence.
   - Two exchange rates link the tiers: β (`INFERRED` relative to `DIRECT`) and γ (the refinement
     band).
   - The prize is normalized by the request's best candidate. Stated importance is relative within
     one request, so K reads as "tme worth the request's best Experience".
   - A rank-only prize (for example, linear in rank) would discard the stated importance and make
     Tour value depend on cohort size, so it is rejected.
4. **The candidate order must survive equal-cost swaps** (P-D1..P-D3). Confidence is continuous, so a
   low-confidence `INFERRED` match can sit arbitrarily close to zero. No fixed γ > 0 can then keep it
   above every semantic-only candidate. The projection therefore needs one lossless, deterministic
   step: an **order-preserving repair**. In A's order, raise any prize that falls at or below the next
   lower-ranked prize to that prize plus one integer unit (the adapter's resolution). Cardinal
   magnitudes change only at such near-ties. This is part of the B projection, not a change to A.
5. **"One higher-ranked Experience vs several lower-ranked ones" is a ratio, not a rule.** With
   additive prizes, n lower-ranked Experiences beat one higher-ranked one iff n·p_low > p_high (at
   equal travel). Under the PROPOSED region:
   - two medium `DIRECT` beat one strong `DIRECT` (P-O5: importance adds);
   - one weak `DIRECT` beats two strong `INFERRED` at confidence 0.8 (P-O6, which forces β < 0.31);
   - the derived bound β + γ < 0.5 (P-D2) makes a weak `DIRECT` match worth more than any single
     `INFERRED` one.
6. **Accepted semantics alone do not determine B.**

   | parameter | DERIVED judgments only | + PROPOSED judgments |
   |---|---|---|
   | K (tme for the request's best, a strong DIRECT) | 10 … ≥ 663 (both ends at the grid edge) | **61 … 144** |
   | β (INFERRED per DIRECT unit) | ≤ 0.48 | **0.10 … 0.30** |
   | γ (refinement band) | ≤ 0.21 | **0.076 … 0.21** |
   | c_DRIVE | unbounded | ≤ 2.0 (definitional choice 1.0 below) |
   | A_DRIVE (tme per drive leg), c_DRIVE = 1 | unbounded | **8.6 … 14.8** |
   | ρ (UNKNOWN-hours, relative), K = 100 | 0 < ρ < 1 | **0.054 … 0.27** |
   | c_BICYCLE / A_BICYCLE, c_DRIVE = 1, A_DRIVE = 11 | unbounded | c_BICYCLE ≤ 1.36 (no lower bound); A_BICYCLE **2.0 … 12.7** |
   | A_BICYCLE if c_BICYCLE = 1 | — | **3.2 … 5.9** (narrow) |

7. **Mode friction is necessary.**
   - With minutes only (A_DRIVE = 0), the walk-vs-drive judgments M-O1 to M-O4 can only all hold if
     a driving minute costs 3-3.75 walking minutes. M-O5 (one 20-min leg beats two 8-min legs) fails
     for every c_DRIVE, because only a per-leg term can price the extra activation. With all
     judgments, the region needs A_DRIVE ≥ 6.3. This matches the P-D7 spike's structural finding,
     which was made without its coefficients.
   - Friction is a product utility term. It is not added to any travel estimate and is not called
     parking or pick-up time.
8. **UNKNOWN hours: the cost is relative,** `ρ·f_i·p_i` with 0 < ρ < 1. P-D4 gives ρ > 0 (U-D1), and
   ρ < 1 keeps every UNKNOWN Experience's net prize positive, so the cost alone never erases it (U-D2).
   Only travel can then exclude it, exactly as for a KNOWN Experience of the same value. An absolute
   per-visit cost has the suppression boundary the P-D7 spike measured, so it is rejected. U-O1 (an
   UNKNOWN strong `DIRECT` beats a KNOWN weak `DIRECT`) gives ρ < 0.5.

## Check point and stability

Check point (PROPOSED, owner-dependent): K = 100, β = 0.2, γ = 0.12, c_DRIVE = 1, A_DRIVE = 11,
c_BICYCLE = 0.6, A_BICYCLE = 6, ρ = 0.15.

- **Judgments.** All 32 hold. The minimum `log(lhs / rhs)` is 0.18 (P-O7, semantic swap at +5 min);
  every other judgment has at least 0.20.
- **Perturbation.** Varying each parameter ×0.75 / ×1.33 flips only P-O7, and only at K×0.75 or
  γ×0.75. P-O7 is the knife-edge judgment.
- **Tours** (`runs/tours_summary.json`, 732 OR-Tools runs, BA/PA/LA × S1 normal 3-day / S2 tight
  hours / S5 1-day oversupply / S9 start+end anchors × WALK / WALK+DRIVE / WALK+BICYCLE /
  WALK+DRIVE+BICYCLE / BICYCLE):
  - **Safety.** 732/732 PLANNED, 0 hard-constraint violations, 0 forbidden-mode legs, 0
    non-identical repeats, every stop SOLUTION_LIMIT. Solve time median 1.9 s, max 5.0 s with 8
    parallel runs. The San Telmo composite was never scheduled without WALK: its traversal is valid on
    foot only.
  - **Cross-city behaviour, one policy, no city-specific value.**
    - `DIRECT` share of scheduled Experiences at the check point: 0.50-0.76 in every city and
      profile, against a test-only pool share of 0.30-0.38 (BA 11/29, PA 9/30, LA 11/30).
    - With WALK+DRIVE: 0 drive legs replacing a ≤ 10 min walk. Drive legs have a median of 3.9 /
      4.4 / 9.5 min (BA / PA / LA). LA drives most; compact Paris drives short hops between
      clusters.
  - **Stability under one-at-a-time ×0.75 / ×1.33:**
    - Σ `DIRECT` importance retention: mean 0.99-1.00 for every parameter; worst 0.76 (K×0.75,
      c_BICYCLE×1.33), 0.90-0.91 otherwise.
    - Selection Jaccard: mean 0.86-0.95.
    - Changes mix objective effects with GLS search noise (below).

## Solver impact (P-D5 not reopened)

Every plan produced for the same problem by any parameter point was re-scored under the check-point
objective (`runs/crosseval.json`). The SL1000 check-point plan:
- is > 1 % below the best known in 18/60 problems (mean 1.0 %, max 7.2 %);
- equals or beats it in 26;
- has its largest gaps on start+end anchored scenarios.

That is the same pattern as the recorded P-D5 finding (13/28, max 8.7 %), not a material worsening.
It stays a P-D5 quality follow-up (multi-start / first-solution strategy under count-based
determinism). `routing-gls-sl1000-v1` remains operationally acceptable.

## Owner decision table (answered 2026-10-15: every row accepted)

Each row is a PROPOSED judgment. The owner accepted all of them on 2026-10-15 as the initial judgment
set; changing one later is a new policy version. The last column shows which
bound each answer sets; `runs/judgments.json` → `dropOneSensitivity` shows the region without each
judgment.

| id | Tour A (proposed preferred) | Tour B | bound it sets |
|---|---|---|---|
| P-O1a/b | add a strong DIRECT Experience at +40 / +60 min travel | don't | K > 60 |
| P-O1c | don't | add a strong DIRECT Experience at +150 min | K < 150 |
| P-O2a/b | add a weak DIRECT at +20 min; don't add it at +75 min | the opposite | 40 < K < 150 |
| P-O3a/b | add a strong INFERRED (conf 0.8) at +10 min; don't at +45 min | the opposite | 12.5 < βK < 56 |
| P-O4a/b | add the best semantic-only Experience at +3 min; don't at +20 min | the opposite | 3 < γK < 20 |
| P-O5 | two medium DIRECT | one strong DIRECT | importance is additive |
| P-O6 | one weak DIRECT | two strong INFERRED (conf 0.8) | β < 0.31 |
| P-O7 | swap to a better-refined Experience (Δr 0.5, equal explicit evidence) at +5 min | keep the original | γK > 10 (narrowest) |
| U-O1 | UNKNOWN-hours strong DIRECT | KNOWN-hours weak DIRECT | ρ < 0.5 |
| U-O2 / U-O3 | KNOWN alternative at +5 min; UNKNOWN rather than a KNOWN alternative at +30 min | the opposite | 5 < ρK < 30 |
| M-O1 / M-O2 | walk 8 vs drive 3 → walk; walk 12 vs drive 4 → walk | drive | A_DRIVE > 8 (c_DRIVE = 1) |
| M-O3 / M-O4 | walk 20 vs drive 5 → drive; walk 30 vs drive 8 → drive | walk | A_DRIVE < 15 |
| M-O5 | one 20-min drive leg | two 8-min drive legs | A_DRIVE > 4 |
| B-O1 | walk 6 vs bicycle 3 → walk | bicycle | A_BICYCLE > 6 − 3·c_BICYCLE |
| B-O2 / B-O3 | bicycle 5 vs walk 15 → bicycle; bicycle 8 vs walk 25 → bicycle | walk | A_BICYCLE < 15 − 5·c_BICYCLE |
| B-O4 | bicycle 10 vs drive 5 (both allowed) → bicycle | drive | 10·c_BICYCLE + A_BICYCLE < 16 |
| B-O5 | drive 10 vs bicycle 35 → drive | bicycle | 35·c_BICYCLE + A_BICYCLE > 21 |

Definitional questions that are not pairwise judgments:
- **D1. Is a driving minute as burdensome as a walking minute (c_DRIVE = 1)?** The judgments allow
  0.25-2.0. Proposed: 1, so elapsed time is the burden and friction carries the activation cost.
- **D2. Is a cycling minute as burdensome as a walking minute (c_BICYCLE = 1)?** At 1, the region for
  A_BICYCLE is narrow (3.2-5.9) because B-O1 and B-O4 pull against each other. The check point's 0.6
  is a proposal that makes cycling cheaper per minute than walking. Either confirm it, or revisit
  B-O1 / B-O4.
- **D3. Cycling effort limit.** The request contract has walking limits (distances) but none for
  cycling. Planned single BICYCLE legs reach 59 min (BA) and 54 min (LA). Should a request-level
  cycling limit exist? It would be a hard request constraint, like walking, never an objective
  weight. No limit is invented here.
- **D4. Order-preserving repair** (structural finding 4). Confirm that the B projection may raise
  prizes at near-ties so that equal-cost swaps always follow A's order.

## Owner decisions and adopted policy (2026-10-15)

- **Judgments.** The 25 PROPOSED judgments are accepted as the initial, versioned product-policy
  judgment set: a baseline that may be revised, not an immutable truth.
- **D1.** 1 DRIVE minute = 1 WALK minute (c_DRIVE = 1); DRIVE friction stays a separate per-leg term.
- **D2.** 1 BICYCLE minute = 1 WALK minute (c_BICYCLE = 1); BICYCLE friction stays a separate per-leg
  term.
- **D3.** When BICYCLE is allowed, the PlanningRequest contains a resolved hard cycling limit. It is a
  feasibility constraint, never an objective weight. An input adapter resolves it before planning,
  from explicit user input, conversational intent, a contextual UI action, a named/versioned mobility
  profile or a future adapter, and the planner never knows which surface produced it. No universal
  numeric default is invented; an unresolved limit is invalid planning input. Task 25.1 decides its
  representation and unit (design P7).
- **D4.** The order-preserving repair is accepted. It may only preserve A's deterministic order at
  ties or near-ties created by the projection. It must add no preference signal, must not overturn
  materially different satisfaction, must stay deterministic, and must be explainable in the
  generation trace.

`preference-objective-v1` (EVIDENCE_BACKED_INITIAL_POLICY): K 100, β 0.20, γ 0.12, c_DRIVE 1,
A_DRIVE 11, c_BICYCLE 1, A_BICYCLE 4.5, ρ 0.15 (c_WALK 1, A_WALK 0).

Validation at this policy (scripts rerun 2026-10-15 with `GP7UB_POINT=adopted`):
- **Judgments.** All 32 hold. The narrowest margins are B-O4 (bicycle 10 vs drive 5) at 0.098 and P-O7
  at 0.18. A_BICYCLE 4.5 lies inside the c_BICYCLE = 1 region 3.2-5.9.
- **Perturbation.** One-at-a-time ×0.75 / ×1.33 flips P-O7 (K×0.75, γ×0.75) and B-O4 (A_DRIVE×0.75,
  c_BICYCLE×1.33). That is the narrow bicycle region accepted with D2.
- **Tours** (`runs/tours_adopted.json`, `runs/tours_summary_adopted.json`):
  - 732/732 PLANNED, 0 hard-constraint violations, 0 forbidden-mode legs, 0 non-identical repeats,
    every stop SOLUTION_LIMIT; median solve 1.9 s, max 5.1 s;
  - the San Telmo composite is never scheduled without WALK;
  - `DIRECT` share of scheduled Experiences 0.50-0.74 in every city and profile;
  - WALK+DRIVE+BICYCLE: Paris 0 DRIVE / 50 BICYCLE legs, LA 25 / 11, BA 16 / 36. A cycling minute
    costs more than at the 2026-10-14 check point, so drive takes more of the long legs;
  - stability: Σ `DIRECT` importance retention mean ≥ 0.97, worst 0.81.
- **Search gap** (`runs/crosseval_adopted.json`): 17/60 problems more than 1 % below best known, max
  6.9 %, mean 0.93 %, 28 exact. This is the recorded P-D5 pattern.
- **Longest single rides.** BA 59 min, LA 46 min, Paris 11 min. No cycling limit was applied because
  none exists without a request; under D3 a request's limit makes longer rides infeasible.

**Bicycle sensitivity (calibration provenance, not a gate).** B-O4 is the tightest accepted judgment
(margin 0.098), so the bicycle terms (c_BICYCLE 1.0, A_BICYCLE 4.5) are sensitivity-bound by it. Any
future objective-policy version that changes bicycle cost or friction reruns B-O4, the complete
accepted judgment suite (`scripts/judgments.py`) and the Tour / cross-evaluation regression set
(`scripts/tours.py`, `analyze.py`, `crosseval.py`) before publication.

Recalibration: changing a coefficient, a judgment or the judgment set means rerunning these scripts
and recording a new objective policy version.

## Acceptance (task 33.0 part B)

| # | question | status |
|---|---|---|
| 1 | Tour-level preference satisfaction | answered: Σ per-Experience prizes (structural findings 1-2) |
| 2 | candidate prize / cardinal representation | answered (findings 3-4); β 0.20, γ 0.12 adopted; repair constrained by D4 |
| 3 | many lower-ranked vs one higher-ranked | answered as a ratio rule (finding 5); P-O5 / P-O6 accepted |
| 4 | preference vs travel exchange | K = 100 adopted inside (61, 144) |
| 5 | WALK cost semantics | 1 tme per minute by definition (the unit); hard walking limits unchanged |
| 6 | DRIVE cost semantics | c_DRIVE = 1 (D1) + friction A_DRIVE = 11 inside (8.6, 14.8) |
| 7 | mode friction exists | yes, structurally required (finding 7); A_DRIVE 11, A_BICYCLE 4.5 |
| 8 | UNKNOWN-hours cost | relative ρ = 0.15 inside (0.054, 0.27) at K = 100, never erasing (finding 8) |
| 9 | one policy across BA/Paris/LA | yes in the check-point runs; no city-specific value |
| 10 | non-trivial stable region | yes under PROPOSED judgments (log-widths K 0.86, β 1.13, γ 1.02, A_DRIVE 0.54); P-O7 is the knife-edge |
| 11 | no fixture overfitting | yes: the regions come from judgments only; fixtures are used to validate, not to choose |
| 12 | SL1000 acceptable | yes (0 violations, deterministic, ≤ 5 s); search gap as already recorded for P-D5 |

Rows 2-4, 6 and 8 were blocked only by the owner decision table, which was answered on 2026-10-15.
Every row is now answered, so G-P7-U.B and P-D7 are RESOLVED.

## Limitations

- The preference annotation in `tours.py` is TEST-ONLY:
  - classes come from a hash of the candidate id;
  - r_i comes from fixture desirability.

  It exercises the solver behaviour under the objective family; it is not product data.
- BA durations are the spike 3 flat 60 min; Paris/LA durations come from the fixture class rule.
- Perturbation runs mix objective effects with single-start GLS noise; the cross-evaluation separates
  the two.
