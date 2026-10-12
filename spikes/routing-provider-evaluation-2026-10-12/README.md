# Routing provider evaluation (P-D1 evidence) — 2026-10-12

Bounded evaluation for OpenSpec change `gap-driven-destination-knowledge`,
design P-D1 (routing / travel-time strategy). It does not select a provider.
Historical spikes 1-3 are read only (`inputs/ba_pool.json` is copied from
spike 3 `runs/S3-A/report.json` planner input).

## Question

Which routing strategy can serve the Zig-Zag planner workload (ordinary legs,
bulk pair costs for the optimizer, provider-backed timing of a required
bounded ROUTE traversal) with correct, deterministic validation and sensible
economics?

## Environment and inputs

- Host: Apple Silicon (arm64), 10 CPUs; Docker VM 15.6 GiB / 10 CPUs. Not
  production-sized; latency figures are relative evidence.
- Valhalla `3.9.1-e73132a7d`, image
  `ghcr.io/valhalla/valhalla-scripted@sha256:449c8d20…` (see
  `results/image-digest.txt`), native arm64, 8 server threads, built from
  Geofabrik `argentina-261011.osm.pbf` (432,661,999 bytes, md5
  `eaa33fad0bd3e6f302987d9e8910ec76`), admins + time zones, no elevation.
- Geoapify: existing account key (never written to disk), Routing, Route
  Matrix and Map Matching APIs, 2026-10-12.
- Mapbox: no token available → not executed. Google: not executed (not
  competitive on the cost model; see below).
- San Telmo traversal geometry: built only from OSM via the local Argentina
  Overpass (`inputs/defensa_full.json`, `scripts/build_segment.py`):
  Defensa from node 195866927 (Defensa/Chile) to node 205553448
  (Defensa/Humberto I), OSM ways 473141731, 150893241, 158893264; 13 nodes;
  521.4 m (`inputs/defensa_chile_humberto.geojson`).
- Candidate pool: the 45 spike 3 S3-A Buenos Aires planner candidates.

## Results

### Valhalla (self-hosted, Argentina)

- Build: 14:15:35 → 14:27:28 UTC (~12 min, 8 threads), peak container
  memory 4.67 GiB, tiles 807 MB + admins 20 MB + time zones 128 MB; serving
  RSS 245 MiB idle, 2.9 GiB after the benchmark (tile cache).
- Full NxN `sources_to_targets` (costmatrix; medians of 5 across the
  three recorded runs, `results/bench_results.json` and
  `results/bench_matrix_algorithms.json`): pedestrian 10/20/30/45 →
  0.4-1.0 / 2.4-4.1 / 4.3-5.7 / 8.4-10.4 s; auto → 0.6-1.4 / 2.0-2.8 /
  2.9-5.4 / 4.0-6.5 s; bicycle → 0.4-0.7 / 2.0-2.4 / 2.5-3.7 / 4.6-9.6 s.
  30x30 pedestrian throughput saturates at ~0.7 req/s (concurrency 4-16).
- Sparse shape (each candidate → its 10 nearest, one-to-many,
  `results/bench_knn.json`): 45 candidates in 0.19-0.46 s with 8 parallel
  requests, 0.55-1.64 s sequential — 10-40x faster than the full matrix.
- No unreachable pairs in any mode.
- San Telmo: pedestrian `trace_route` (map_snap, edge_walk, walk_or_snap)
  → 522-523 m, 376.2 s, 23-155 ms; `trace_attributes` → exactly OSM ways
  {150893241, 158893264, 473141731}, name "Defensa", max point offset
  0.06 m, 0 unmatched. Auto/bicycle traces fail to follow Defensa (other
  streets, 4 unmatched points, empty trip) — correct, Defensa is not
  traversable for those modes.

### Geoapify (managed)

- Map Matching (`mode=walk`, 13 points): 523 m, 405 s, single step
  "Defensa", every point matched/interpolated within 0.2 m; 0.47-0.71 s;
  ~1 credit.
- Routing endpoint-only Chile → Humberto I: walk 523 m / 502 s (on
  Defensa); drive 1,023 m / 99 s and bicycle 889 m / 206 s leave Defensa.
- Route Matrix modes: walk, bicycle, drive accepted; `transit` and
  `approximated_transit` rejected (transit exists only in per-pair Routing).

### Deterministic traversal validation (`scripts/validate.py`)

Directional, geometric, provider-independent: coverage of the required
segment by the output and fraction of the output on the segment at
2/5/10/15 m, symmetric Hausdorff distance, and backtracking along the
source.

| Output | coverage@2m | on-source@2m | Hausdorff | Verdict |
|---|---|---|---|---|
| Valhalla pedestrian trace (map_snap / edge_walk) | 1.00 | 1.00 | 0.0 m | respects |
| Valhalla pedestrian endpoint route | 1.00 | 1.00 | 0.0 m | respects (coincidence) |
| Geoapify walk map matching | 1.00 | 1.00 | 0.2 m | respects |
| Geoapify walk endpoint route | 1.00 | 1.00 | 0.2 m | respects (coincidence) |
| Geoapify/Valhalla drive endpoint route | 0.008 | 0.006 | 266 m | violates |
| Geoapify/Valhalla bicycle endpoint route | 0.008 | 0.007 | 194 m | violates |
| Valhalla auto trace (empty trip) | 0.004 | 1.00 (vacuous) | 450 m | violates — needs both directions |

Separation is wide on this case, but one traversal is not calibration
evidence: thresholds need the calibration gate (design P-D1).

### Timing models differ

Same 521 m on foot: Valhalla 376 s, Geoapify map matching 405 s, Geoapify
routing 502 s. Provider (and API) choice changes schedules by up to ~33%;
estimates must carry provider + API provenance and must not be mixed within
one plan without recording it.

### Pricing (retrieved 2026-10-12)

- Mapbox (mapbox.com/pricing): Matrix billed per element, 100,000 free/month,
  $2.00/1k to 500k, $1.60/1k to 1M, $1.20/1k beyond (5M+ contact sales);
  Directions and Map Matching per request, same tiers; Matrix ≤25
  coordinates (10 for driving-traffic), 60 req/min; Map Matching ≤100
  coordinates, 300 req/min; no transit; `depart_at` beta.
- Geoapify (geoapify.com/pricing, /pricing-details): Free 3,000 credits/day;
  $59 10k/day; $109 25k; $179 50k; $299 100k; $609 250k; Custom unmetered
  from $860. Routing = waypoints−1 credits; Matrix =
  max(sources,targets)·min(sources,targets,10) credits, ≤1,000 elements;
  Map Matching = 1 credit per 100 points.
- Google (developers.google.com/maps/billing-and-pricing/pricing): Compute
  Route Matrix Essentials 10,000 free/month, $5.00/1k (first paid tier;
  higher tiers not retrieved → upper bound); Pro $10, Enterprise $15.
- Self-host reference (third-party aggregators of AWS on-demand,
  us-east-1): r7g.large (2 vCPU, 16 GiB) $0.1071/h ≈ $78/month; r7g.xlarge
  (4 vCPU, 32 GiB) ≈ 2x.

### Monthly cost model (`scripts/cost_model.py`)

**2 modes per request** (full = all ordered pairs incl. 2 day anchors; kNN = each candidate to its 10 nearest)

| Pool | Tours/month | Mapbox full | Mapbox kNN | Google full | Google kNN | Geoapify full | Geoapify kNN |
|---|---|---|---|---|---|---|---|
| 10 | 100 | $0 | $0 | $82 | $80 | $0 | $0 |
| 10 | 1,000 | $328 | $320 | $1,270 | $1,250 | $59 | $59 |
| 10 | 10,000 | $3,568 | $3,520 | $13,150 | $12,950 | $299 | $299 |
| 10 | 100,000 | $32,080 | $31,600 | $131,950 | $129,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 20 | 100 | $0 | $0 | $412 | $230 | $0 | $0 |
| 20 | 1,000 | $1,478 | $896 | $4,570 | $2,750 | $109 | $109 |
| 20 | 10,000 | $11,488 | $7,120 | $46,150 | $27,950 | $609 | $609 |
| 20 | 100,000 | $111,280 | $67,600 | $461,950 | $279,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 30 | 100 | $197 | $0 | $942 | $370 | $0 | $0 |
| 30 | 1,000 | $2,781 | $1,344 | $9,870 | $4,150 | $109 | $109 |
| 30 | 10,000 | $24,208 | $10,480 | $99,150 | $41,950 | $609 | $609 |
| 30 | 100,000 | $238,480 | $101,200 | $991,950 | $419,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 50 | 100 | $849 | $80 | $2,602 | $650 | $59 | $59 |
| 50 | 1,000 | $6,765 | $2,080 | $26,470 | $6,950 | $299 | $179 |
| 50 | 10,000 | $64,048 | $17,200 | $265,150 | $69,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 50 | 100,000 | $636,880 | $168,400 | $2,651,950 | $699,950 | Custom (from $860, quote) | Custom (from $860, quote) |

**3 modes per request** (full = all ordered pairs incl. 2 day anchors; kNN = each candidate to its 10 nearest)

| Pool | Tours/month | Mapbox full | Mapbox kNN | Google full | Google kNN | Geoapify full | Geoapify kNN |
|---|---|---|---|---|---|---|---|
| 10 | 100 | $0 | $0 | $148 | $145 | $0 | $0 |
| 10 | 1,000 | $592 | $580 | $1,930 | $1,900 | $109 | $109 |
| 10 | 10,000 | $5,152 | $5,080 | $19,750 | $19,450 | $609 | $609 |
| 10 | 100,000 | $47,920 | $47,200 | $197,950 | $194,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 20 | 100 | $77 | $0 | $643 | $370 | $0 | $0 |
| 20 | 1,000 | $2,063 | $1,344 | $6,880 | $4,150 | $109 | $109 |
| 20 | 10,000 | $17,032 | $10,480 | $69,250 | $41,950 | $609 | $609 |
| 20 | 100,000 | $166,720 | $101,200 | $692,950 | $419,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 30 | 100 | $395 | $52 | $1,438 | $580 | $59 | $59 |
| 30 | 1,000 | $3,971 | $1,912 | $14,830 | $6,250 | $179 | $179 |
| 30 | 10,000 | $36,112 | $15,520 | $148,750 | $62,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 30 | 100,000 | $357,520 | $151,600 | $1,487,950 | $629,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 50 | 100 | $1,273 | $220 | $3,928 | $1,000 | $109 | $59 |
| 50 | 1,000 | $9,947 | $2,920 | $39,730 | $10,450 | $609 | $299 |
| 50 | 10,000 | $95,872 | $25,600 | $397,750 | $104,950 | Custom (from $860, quote) | Custom (from $860, quote) |
| 50 | 100,000 | $955,120 | $252,400 | $3,977,950 | $1,049,950 | Custom (from $860, quote) | Custom (from $860, quote) |

Caveats: no cross-request caching of pair costs is assumed (its legality
depends on each provider's terms — open gate); Geoapify plan selection
assumes uniform daily load; Google uses only its first paid tier.

### Valhalla resource estimate

- Regional (Argentina, measured): build ~12 min / 4.7 GiB peak, ~1 GB
  data; serving fits a 2 vCPU / 16 GiB instance (≈$78/month on-demand)
  with headroom; two instances for availability ≈$156/month.
- Broader (South America, extrapolated, not measured): extract
  4,139,097,147 bytes (~9.6x Argentina) → order of 8-10 GB tiles, build
  roughly 1.5-2 h and >16 GiB build memory; serving 4 vCPU / 32 GiB class.
  Requires its own measurement before use.
- Not included: engineering/operations time, OSM update pipeline (weekly
  rebuild + swap), monitoring; Nominatim is a separate service (below).

### Nominatim (separate from routing)

The local Argentina Nominatim (ui-redesign stack) uses a 6.4 GB database
volume and ~1.4 GiB RAM at rest. Its production role is assessed in design
P-D1; it is not part of the Valhalla cost.

## Reproduce

`scripts/build_segment.py` (Overpass → segment), `scripts/bench.py`
(Valhalla on `localhost:8102`), `scripts/validate.py <segment> <output>`,
`scripts/decode.py` (Valhalla polyline6), `scripts/cost_model.py`.
