# Planner comparison — pre-registered protocol (2026-10-12)

Written before any comparison run (design P11, P-D6). Changing anything here
after results are seen requires a new experiment version.

- **Datasets** (`fixtures/`): BA = spike 3 S3-A planner pool (read-only; top
  28 by the spike 3 structured ranking) + one composite "San Telmo walk"
  (TRAVERSE Defensa Chile→Humberto I from the G2 segment BA-00, then VISIT
  Mercado de San Telmo); PA and LA = frozen public OSM snapshots (30 places
  each, tourism/historic features with Wikidata ids, desirability =
  log(1+sitelinks) normalized per city). One hotel anchor per city (nearest
  named OSM hotel to the candidate centroid).
- **Pool sizes**: 10, 20, all (BA 29 incl. the composite, PA 30, LA 30),
  nested by desirability.
- **Travel**: Geoapify Route Matrix walk and drive, recorded once
  (`fixtures/*_matrix_*.json`) and replayed; composite internal walking leg
  recorded with Geoapify Routing; Defensa traversal time from the G2
  Geoapify map-matching recording. No speed-based estimate anywhere.
- **Fixture facts**: opening hours parsed from OSM `opening_hours`
  (supported subset; anything else UNKNOWN); visit durations: BA = spike 3
  flat 60 min (fallback provenance), PA/LA = test-only fixture rule by
  feature class; composite desirability fixture value 0.85. None of these
  is product policy.
- **Calendar**: 2026-11-10 (Tue), 2026-11-11 (Wed), 2026-11-12 (Thu);
  destination-local minutes.
- **User constraints**: day window 09:00-19:00 unless the scenario says
  otherwise; max continuous walking leg 30 min; daily walking budget 150
  min; allowed modes walk + drive unless the scenario says walk-only.
- **Test-only objective weights** (`scripts/common.py`, `WEIGHTS`), not P-D7:
  desirability 1000 per unit (normalized 0..1); travel cost 10 per minute
  walked and 20 per minute driven plus 100 per drive leg (mode preference:
  walking wins up to ~20 min against a ~5 min drive; set before any run,
  replacing a provisional 15/50 that preferred a 3 min drive over a 10 min
  walk);
  openingHoursUncertaintyPenalty 100 per scheduled UNKNOWN-hours VISIT
  component; idle time 0 (measured only). Variant runs: uncertainty
  penalty 0 (S3b).
- **Mode choice**: per arc, among allowed modes with an estimate, the mode
  with the lowest weighted cost subject to the continuous-walking limit
  (dominated-mode pruning, design P9); the daily walking budget is a hard
  constraint in every solver.
- **Scenarios** (each city unless noted): S1 normal 3 days; S2 tight hours
  (day window 13:00-19:00); S3 UNKNOWN hours (PENALIZE, compare S3b weight 0);
  S4 mustInclude (2 items: lowest-desirability KNOWN-hours item and the
  farthest item); S5 oversupply (1 day); S6 spatial trade-off (1 day,
  walk-only); S7 planner-limited classification (from S5); S8 infeasible
  (mustInclude a KNOWN-hours item on a 1-day trip with a day window where it
  is closed); S9 anchors none / start / start+end (hotel); S10 composite (BA
  S1 includes it).
- **Solvers**: greedy port of the current planner (rank placement,
  nearest-feasible ordering, repair) with (a) current walk-whenever-allowed
  mode rule and (b) cost-based modes; greedy best-insertion; OR-Tools
  Routing (days as vehicles, per-day node copies, disjunction penalty =
  desirability weight); OR-Tools CP-SAT (per-day circuits with optional
  nodes, interval/precedence via enforced literals). Budgets: Routing
  1 s / 5 s / 30 s time limits; CP-SAT max deterministic time 1 / 5 / 30,
  1 worker, fixed seed 7. Three repetitions for runtime.
- **Correctness**: one independent checker (`scripts/check.py`) for every
  output: day window, KNOWN opening windows (incl. composite internal
  components), KNOWN-closed, travel consistency with the recorded matrix
  and chosen mode, continuous-walking limit, daily walking budget,
  mustInclude, duplicates, anchors. A violating output fails regardless of
  score.
- **Metrics**: as listed in the OpenSpec request; no single opaque score in
  the analysis.
