# Planner comparison spike (P-D5 / P-D7 evidence) — 2026-10-12

OpenSpec change `gap-driven-destination-knowledge`, design P11 / P12, task
group 31. Evidence only: no production code. Protocol: `PROTOCOL.md`
(pre-registered; the provisional drive weights were corrected before any
run, as recorded there). Full tables: `RESULTS.md`; per-run raw outputs
(itinerary, violations, metrics, solver meta): `runs/*.json`; summary and
manifest: `runs/summary.json`; post-hoc CP-SAT: `runs/posthoc_cpsat.json`.

## What was run

- **Datasets** (`fixtures/`, version `pc-2026-10-12`): Buenos Aires = 28
  real spike 3 S3-A candidates (OSM identity, coordinates, spike 3 ranking,
  OSM opening hours, spike 3 fallback durations) + the composite "San Telmo
  walk" (TRAVERSE Defensa Chile→Humberto I timed by the recorded G2
  map matching, internal walking leg recorded with Geoapify Routing, VISIT
  Mercado de San Telmo with its OSM hours); Paris and Los Angeles = frozen
  public-OSM snapshots of 30 Wikidata-linked attractions each (desirability
  log(1+sitelinks), OSM hours, test-only duration rule); one real OSM hotel
  anchor per city. Unparseable or missing hours are UNKNOWN (BA 15/29,
  PA 21/30, LA 15/30).
- **Travel**: Geoapify Route Matrix walk + drive (31 points per city,
  recorded once, replayed); Paris walking has unreachable pairs (Centre
  Pompidou), handled as unavailable mode. No speed-based estimate.
- **Scenarios** (each city): normal 3-day at pools 10 / 20 / ~30, tight
  hours (13:00-19:00), UNKNOWN hours PENALIZE vs weight 0, mustInclude,
  1-day oversupply, 1-day walk-only spatial trade-off, infeasible closed
  must-include, anchors none / start / start+end, composite (BA).
- **Solvers**: greedy port of the current planner (rank-order placement
  with day-balance bonus, nearest-feasible ordering, lowest-priority
  repair) with today's walk-whenever-allowed mode rule and with cost-based
  modes; greedy best-insertion (improved greedy); OR-Tools Routing 9.15
  (days = vehicles, per-day node copies, disjunction penalty = desirability,
  time + walking dimensions, GLS, 1 / 5 / 30 s); OR-Tools CP-SAT (per-day
  circuits with optional nodes, start-time domains = opening-window unions,
  enforced precedence; 1 worker, seed 7, deterministic time 1 / 5 / 30) plus
  post-hoc 8-worker and hinted variants.
- **Test-only weights** (not P-D7): desirability 1000 per unit; travel 10
  per walked minute, 20 per driven minute + 100 per drive leg;
  openingHoursUncertaintyPenalty 100 per UNKNOWN-hours VISIT; idle 0. Limits:
  30 min continuous walking, 150 min walking per day.

## Findings

**Correctness.** 234 runs; every produced Tour passed the independent
checker — 0 hard-constraint violations for every approach. Must-include
conflicts (closed must-include; LA's pre-registered must-include open Fr-Su
only on a Tue-Thu trip) were reported explicitly by every solver. The
pre-registered CP-SAT configuration failed to produce any Tour on 20 runs
(every ~30-candidate pool, LA pool 20 at dt=1) — a production failure mode
(it would surface as a planner timeout, not infeasibility).

**Quality** (objective under the test weights; scheduled Experiences;
`RESULTS.md`):

- The current greedy is materially worse everywhere: fewer Experiences
  (e.g. BA ~30-pool 21 vs 27, LA 16 vs 21-22) and large idle time (up to
  360 min). Its walk-whenever-allowed mode rule is pathological: in LA it
  schedules 3 Experiences on a 3-day trip because walking is picked first
  and then rejected by the walking limit.
- Greedy best-insertion fixes most of that: within 0-5 % of Routing on
  normal 3-day tours (better in 3 cases), within 1.1 % of the proven
  optimum on 10-candidate pools, but 7-14 % behind Routing in constrained
  cases (Paris tight hours and 1-day oversupply, LA 20-candidate pool, LA
  start+end anchors) — typically one or two fewer Experiences.
- Routing (5 s) is best or near-best in most scenarios, within 4.5 % of the
  proven optimum on 10-candidate pools; 1 s is already close to 5 s; 30 s
  adds ≤ 1.4 %.
- CP-SAT is optimal on 10-candidate pools (< 0.1 s) and on Paris
  20-candidate pools (0.6 s), but in this formulation does not scale to ~30
  candidates within practical budgets: no solution with 1 worker; with 8
  workers or a greedy hint it finds Tours in 7-55 s that do not beat
  Routing 5 s, with loose bounds (6-45 % gap) and nondeterminism at 8
  workers.

**Runtime** (this laptop): greedy current < 1 ms; greedy best-insertion
~30 ms on 30 candidates × 3 days; Routing quality is budget-bound (1-5 s);
CP-SAT see above. Pair edges ~810-870 per city at ~30 candidates.

**Scaling.** Greedy insertion is O(n² · positions · days) — trivial at
these sizes. Routing's node count is candidates × feasible days (per-day
copies needed because opening hours differ by weekday); fine at 90 nodes.
CP-SAT arc literals grow as days × n², and its difficulty, not its size,
is the limit.

**Opening hours.** All approaches respected KNOWN windows, split windows
and closed days (checker). Tight windows (S2) separate the methods most
(Paris: Routing 18 vs best-insertion 16 vs current 11-17). UNKNOWN hours
under PENALIZE remained schedulable; weight 100 vs 0 reduced UNKNOWN visits
modestly (Routing BA 15→14, PA 20→19, LA 12→9).

**Travel modes.** Cost-based per-arc mode choice (dominated-mode pruning
under the walking limits) produced mixed walk/drive days; the current
walk-first rule is the main defect of today's planner. Mode choice was not
optimized jointly with the daily walking budget (budget enforced as a hard
dimension/constraint over pre-pruned arcs).

**Composite.** The San Telmo walk was always one candidate (54.6 min
internal timeline), scheduled by every solver that produced a Tour, with the
Mercado window checked on its internal timeline — natural in all three
approaches (one node/interval with start-time domain derived from the
internal timeline).

**Anchors.** First/last-mile legs appear only when anchors exist (checker);
start+end anchors are where Routing gains most over greedy (LA +13.5 %).

**Readiness.** Classification from planner output works, but a weaker
planner inflates PLANNER_LIMITED (greedy current leaves meaningful residual
where optimizers report READY; LA Routing 1 s PLANNER_LIMITED vs 5 s
READY). The "candidate-supply limited" verdicts on 10/20 pools are an
artifact of truncating the pool in this spike.

## Comparison

| Dimension | Greedy (current / best-insertion) | OR-Tools Routing | CP-SAT |
|---|---|---|---|
| hard-constraint correctness | 0 violations / 0 violations | 0 violations | 0 violations; no Tour on 20 runs |
| selection quality | weak / good, 7-14 % behind in tight cases | best or near-best | optimal ≤ 20 candidates; poor beyond |
| ordering quality | nearest-neighbour, idle-heavy / insertion, low idle | GLS, low idle | optimal when solved |
| opening-hours handling | correct; weakest in tight windows / correct | correct; best in tight windows | correct |
| multi-day handling | rank-order day filling / joint insertion over days | native (vehicles) | native (per-day circuits) |
| mustInclude | placed first; explicit conflict / forced insertion; explicit | mandatory disjunction; explicit | hard constraint; explicit |
| mode choice | walk-first rule is pathological / cost-based | cost-based arcs | cost-based arcs |
| composite compatibility | one candidate | one node, start/end points | one interval |
| runtime small pool | < 1 ms / ~1 ms | budget-bound (1 s ≈ 5 s quality) | < 0.1 s, optimal |
| runtime ~30 pool | < 1 ms / ~30 ms | budget-bound, 1-5 s | no solution (1 worker); 7-55 s with 8 workers / hint |
| implementation complexity | low / low (≈ 60 lines here) | moderate: per-day node copies, dimensions, disjunctions; new runtime dependency (no official Node binding) | high: sequencing via circuits + enforced precedences; tuning needed |
| explainability | direct / direct (each insertion has a gain) | moderate (dropped nodes = penalties) | low without extra tooling |
| extensibility (e.g. TourStop) | custom insertion/repair per new constraint | native vehicle breaks / optional nodes with windows | optional intervals (natural), but scaling worsens |

## Recommendation

1. Replace the current greedy (its walk-first mode rule and rank-order
   placement are the measured defects).
2. Do not use CP-SAT (this formulation) as the production optimizer.
3. OR-Tools Routing gives the best Tours in the constrained cases that
   matter (tight hours, oversupply, anchors) at a 1-5 s budget; greedy
   best-insertion is the simplest viable alternative (in-process, ~30 ms,
   deterministic) with a measured 7-14 % quality loss in those cases.
4. The remaining unknown is not algorithmic: Routing has no official
   Node.js binding, so production use needs a runtime integration (Python
   sidecar or native binding) and a deterministic stop criterion (time
   limits are not deterministic in principle). That bounded gate decides
   P-D5: Routing if the integration is acceptable, otherwise greedy
   best-insertion.

## For P-D7

- Terms that mattered: desirability (dominant), per-mode travel cost and
  the per-drive-leg overhead (they set the walk/drive mix — a provisional
  15/50 weighting preferred a 3-min drive over a 10-min walk), the
  openingHoursUncertaintyPenalty (modest effect), anchor legs.
- Pathology: when the uncertainty penalty is ≥ an UNKNOWN-hours item's
  desirability value, that item is never selected — the penalty must stay
  bounded relative to the desirability scale (or be relative).
- Idle time was not penalized; optimizers still produced low idle because
  desirability rewards filling the day. Day balance was not penalized and
  was not a problem with optimizers; the greedy day-balance bonus is a
  heuristic artefact.
- A weighted sum with hard constraints kept separate (must-include,
  windows, closed days, walking limits, unavailable modes) produced no
  pathological itineraries; lexicographic ordering was not needed in these
  scenarios.
- Calibration still needed: desirability scale vs travel cost per mode,
  drive overhead, uncertainty penalty bound, behaviour across dense (BA,
  Paris) vs dispersed (LA) cities.

## Limitations

- One laptop; Routing/CP-SAT budgets are wall/deterministic-time limits;
  production latency must be measured in the integration gate.
- Paris/LA durations and desirability are fixture values; BA durations are
  the spike 3 fallback. No meal/break stops (TourStop not modelled).
- Mode choice per arc is pre-pruned (min weighted cost under the walking
  limit); joint mode choice with the daily walking budget was not modelled.
- Readiness verdicts on truncated pools are artifacts.
