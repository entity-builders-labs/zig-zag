# G2 — constrained-traversal validator calibration (2026-10-12)

Gate G2 of P-D1 (OpenSpec `gap-driven-destination-knowledge`, design C16). Evidence-only; no production code. Rerun: `scripts/build_cases.py` → `scripts/run_eval.py` (+ `run_valhalla_paris.py`) → `scripts/ground_truth.py` → `scripts/calibrate.py` → `scripts/report.py`.

## Method

- **Required segments**: OSM way chains of a named street between two intersection nodes with other named roads (`scripts/build_cases.py`); every vertex is an OSM node; provenance in `manifest.json` and `segments.json`.
- **Structural negatives** (built from OSM, never by coordinate noise): REVERSED (node order reversed), PARTIAL (cut at the middle intersection), PARALLEL (nearest other street meeting both cross streets), DETOUR (cross street → parallel street → cross street). Each is validated raw and also sent through the providers.
- **Provider outputs**: Geoapify Map Matching (walk) of the required trace and of every alternative; Geoapify Routing endpoint-only (walk, drive); Valhalla `trace_route` map_snap + `route` (pedestrian) for Buenos Aires and Paris. Geometries normalized to one `[lon,lat]` LineString per output (adapter step: Geoapify MultiLineString flattened, Valhalla polyline6 decoded).
- **Labels** (`scripts/ground_truth.py`), threshold-free and independent of the validator: each densified output point is assigned to its nearest OSM street-centerline way (sidewalk/crossing footways excluded); VALID iff no point lies off the required ways outside a junction neighbourhood (radius = half the shorter adjacent required edge, from the geometry), every required node is covered and coverage is ordered. Structural alternatives agree with their construction labels in every case.
- **Raw metrics** (`scripts/run_eval.py`, no tolerance applied): max/p95 distance required→output (coverage), max/p95 output→required (on-segment), symmetric Hausdorff, forward progress along the required segment, backtracking, provider-unmatched points, lengths.

## Dataset

- 21 required segments: {'BA': 9, 'PA': 7, 'LA': 5} (manifest lists the 4 candidate streets excluded and why).
- 264 outputs, 264 labelled, 0 excluded: **60 VALID**, **204 CONSTRAINT_UNSATISFIED**.
- Positives by source: {'REQUIRED@geoapify': 18, 'ENDPOINT@geoapify': 19, 'REQUIRED@valhalla-3.9.1': 13, 'ENDPOINT@valhalla-3.9.1': 10}.
- Negatives by source: {'REVERSED@structural': 21, 'PARTIAL@structural': 21, 'PARALLEL@structural': 11, 'DETOUR@structural': 8, 'REVERSED@geoapify': 21, 'PARTIAL@geoapify': 21, 'PARALLEL@geoapify': 11, 'DETOUR@geoapify': 8, 'ENDPOINT@geoapify': 23, 'REVERSED@valhalla-3.9.1': 16, 'PARTIAL@valhalla-3.9.1': 16, 'PARALLEL@valhalla-3.9.1': 8, 'DETOUR@valhalla-3.9.1': 7, 'ENDPOINT@valhalla-3.9.1': 6, 'REQUIRED@geoapify': 3, 'REQUIRED@valhalla-3.9.1': 3}.

## Raw distributions

| Metric | VALID range | CONSTRAINT_UNSATISFIED range |
|---|---|---|
| required→output max (m) | 0.04 – 0.6 | 0 – 662.7 |
| required→output p95 (m) | 0.03 – 0.42 | 0 – 618.27 |
| output→required max (m) | 0.04 – 3.08 | 0 – 939.19 |
| output→required p95 (m) | 0.03 – 0.41 | 0 – 876.14 |
| Hausdorff (m) | 0.04 – 3.08 | 0 – 939.19 |
| backtracking (m) | 0 – 0 | 0 – 893.2 |
| provider-unmatched points | 0 – 0 | 0 – 0 |
| forward progress / segment length | 0.9998 – 1 | -1 – 1 |
| output / segment length | 1 – 1.004 | 0.191 – 3.861 |

Reversed outputs coincide with the segment geometrically (Hausdorff ≈ 0) and are separated only by order; partial outputs lie on the segment (output→required ≈ 0) and are separated only by coverage.

## Policy `traversal-validator-v1`

VALID only when all hold; otherwise CONSTRAINT_UNSATISFIED (an empty output fails):

1. **Coverage**: max distance required→output ≤ **2.8 m** — VALID max 0.6 m; nearest non-covering negative 5.15 m; threshold = gap midpoint floored to 0.1 m.
2. **On-segment**: max distance output→required ≤ **4.1 m** — VALID max 3.08 m (an endpoint overshoot into the junction); nearest negative that structurally leaves the required ways 5.23 m; gap midpoint floored to 0.1 m.
3. **Order**: forward progress > 0 — VALID min ratio 0.9998; reversed max -0.4857; the sign is the natural boundary.
4. **No material backtracking**: backtracking ≤ the coverage tolerance (2.8 m) — VALID max 0 m; reversed min 143.0 m. Not an independent number: it reuses condition 1.
5. **Unmatched provider points** ≤ 0 — VALID max 0; not exercised by any negative; kept as fail-closed guard at the positive maximum.

Flooring each midpoint moves the boundary toward the positives (fail-closed).

## Results

- False positives: **0** 
- False negatives: **0** 
- Rejecting conditions over negatives: {'order+backtrack': 48, 'coverage': 53, 'coverage+on_segment': 69, 'coverage+on_segment+backtrack': 24, 'coverage+on_segment+order+backtrack': 9, 'coverage+order+backtrack': 1}. On-segment is never the sole rejecting condition in this dataset; it is kept as the guard for an output that covers the segment but also leaves it (not reproducible structurally here).
- San Telmo (BA-00, Defensa Chile → Humberto I): BA-00:geoapify:REQUIRED:walk VALID (req→out 0.22 m, out→req 0.22 m); BA-00:valhalla:REQUIRED:pedestrian VALID (req→out 0.05 m, out→req 0.05 m)

| Provider | VALID | NEG | VALID req→out max | VALID out→req max | FP | FN |
|---|---|---|---|---|---|---|
| geoapify | 37 | 87 | 0.6 | 3.08 | 0 | 0 |
| structural | 0 | 61 | None | None | 0 | 0 |
| valhalla-3.9.1 | 23 | 56 | 0.06 | 0.06 | 0 | 0 |

## Provider findings

Map matching of the *required* trace that did not follow it (correctly rejected by the validator):

- `PA-01:geoapify:REQUIRED:walk` (Rue Montorgueil): out→req 74.01 m, required nodes covered 10/17.
- `PA-04:geoapify:REQUIRED:walk` (Rue des Rosiers): out→req 34.59 m, required nodes covered 16/18.
- `PA-07:geoapify:REQUIRED:walk` (Rue Saint-Antoine): out→req 9.48 m, required nodes covered 40/48.
- `PA-01:valhalla:REQUIRED:pedestrian` (Rue Montorgueil): out→req 74.01 m, required nodes covered 10/17.
- `PA-04:valhalla:REQUIRED:pedestrian` (Rue des Rosiers): out→req 34.59 m, required nodes covered 16/18.
- `PA-07:valhalla:REQUIRED:pedestrian` (Rue Saint-Antoine): out→req 9.48 m, required nodes covered 40/48.

Both providers fail on exactly the same three Paris segments, so the cause is the required geometry, not a provider: PA-07's chain (built by name) includes separately mapped `highway=cycleway` ways named "Rue Saint-Antoine", which pedestrians cannot use; PA-01 and PA-04 include `highway=pedestrian` + `oneway=yes` ways that both routing graphs treat as one-way for walking. Ground truth labels these outputs CONSTRAINT_UNSATISFIED and the validator rejects them. Consequence for composition: a bounded traversal must be built only from ways the requested mode may traverse in the required direction.

## Negative-control coverage

- endpoint-only route on another street/path: ENDPOINT outputs labelled CONSTRAINT_UNSATISFIED;
- parallel street: PARALLEL;
- partial traversal: PARTIAL;
- reversed traversal: REVERSED;
- off-segment deviation in the middle with correct start/end: DETOUR;
- off-segment excursion while still covering the whole segment: **not reproduced structurally**;
- provider output with unmatched portions: **not reproduced** (no provider reported unmatched points on any output).

## Limitations

- One provider snapshot date; OSM drift between the catalog and a provider's graph can raise positive deviations and is handled fail-closed (CONSTRAINT_UNSATISFIED).
- The on-segment margin is the narrowest (positives up to 3.08 m from a junction overshoot); thresholds must be recalibrated with a new dataset version if providers or geometry sources change.
- Walking only (product scope); drive/bicycle traversals of pedestrian segments are expected to be unavailable or unsatisfied.
