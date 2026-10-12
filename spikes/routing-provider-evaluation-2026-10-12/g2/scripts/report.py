"""Generate g2/README.md and g2/manifest.json from segments.json, raw_metrics.json, calibration.json."""
import json, os, collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
segs=[s for s in json.load(open(os.path.join(ROOT,'segments.json'))) if 'required' in s]
rows=json.load(open(os.path.join(ROOT,'raw_metrics.json')))
cal=json.load(open(os.path.join(ROOT,'calibration.json'))); P=cal['policy']; S=cal['summary']
manifest={'dataset':'g2-2026-10-12','osm_sources':{'BA':'local Overpass, Geofabrik argentina extract (ui-redesign stack)','PA':'public Overpass mirror maps.mail.ru','LA':'public Overpass mirror maps.mail.ru'},
 'segments':[{'id':s['id'],'city':s['city'],'street':s['street'],'kind':s['kind'],'from':s['from'],'to':s['to'],'length_m':s['required']['properties']['length_m'],
   'osm_way_ids':s['required']['properties']['osm_way_ids'],'osm_node_count':len(s['required']['properties']['osm_node_ids']),'alternatives':sorted(s['alternatives'])} for s in segs],
 'excluded_candidates':[{'id':'PA-06','street':'Coulée verte René-Dumont','reason':'no segment between named intersections / public Overpass failure'},
   {'id':'LA-04','street':'Olvera Street','reason':'single way without named intersections: no structural bounds'},
   {'id':'LA-05','street':'Lake Hollywood Drive','reason':'public Overpass failure (gateway timeouts)'},
   {'id':'LA-06','street':'Sunset Boulevard','reason':'no segment between named intersections in the chosen bbox'}],
 'providers':{'geoapify':'Map Matching (walk) and Routing (walk, drive), 2026-10-12','valhalla':'3.9.1 trace_route map_snap + route (pedestrian); Argentina and Ile-de-France tiles, image ghcr.io/valhalla/valhalla-scripted@sha256:449c8d20…'},
 'labels':'ground truth by OSM way identity (scripts/ground_truth.py), independent of the validator; structural alternatives also labelled by construction (all agree)'}
json.dump(manifest,open(os.path.join(ROOT,'manifest.json'),'w'),indent=1)
pos=[x for x in rows if x['gt']=='VALID']; neg=[x for x in rows if x['gt']=='CONSTRAINT_UNSATISFIED']
def rng(v): v=[x for x in v if x is not None]; return f"{min(v):g} – {max(v):g}" if v else "–"
L=[]
L.append("# G2 — constrained-traversal validator calibration (2026-10-12)\n")
L.append("Gate G2 of P-D1 (OpenSpec `gap-driven-destination-knowledge`, design C16). Evidence-only; no production code. Rerun: `scripts/build_cases.py` → `scripts/run_eval.py` (+ `run_valhalla_paris.py`) → `scripts/ground_truth.py` → `scripts/calibrate.py` → `scripts/report.py`.\n")
L.append("## Method\n")
L.append("- **Required segments**: OSM way chains of a named street between two intersection nodes with other named roads (`scripts/build_cases.py`); every vertex is an OSM node; provenance in `manifest.json` and `segments.json`.")
L.append("- **Structural negatives** (built from OSM, never by coordinate noise): REVERSED (node order reversed), PARTIAL (cut at the middle intersection), PARALLEL (nearest other street meeting both cross streets), DETOUR (cross street → parallel street → cross street). Each is validated raw and also sent through the providers.")
L.append("- **Provider outputs**: Geoapify Map Matching (walk) of the required trace and of every alternative; Geoapify Routing endpoint-only (walk, drive); Valhalla `trace_route` map_snap + `route` (pedestrian) for Buenos Aires and Paris. Geometries normalized to one `[lon,lat]` LineString per output (adapter step: Geoapify MultiLineString flattened, Valhalla polyline6 decoded).")
L.append("- **Labels** (`scripts/ground_truth.py`), threshold-free and independent of the validator: each densified output point is assigned to its nearest OSM street-centerline way (sidewalk/crossing footways excluded); VALID iff no point lies off the required ways outside a junction neighbourhood (radius = half the shorter adjacent required edge, from the geometry), every required node is covered and coverage is ordered. Structural alternatives agree with their construction labels in every case.")
L.append("- **Raw metrics** (`scripts/run_eval.py`, no tolerance applied): max/p95 distance required→output (coverage), max/p95 output→required (on-segment), symmetric Hausdorff, forward progress along the required segment, backtracking, provider-unmatched points, lengths.\n")
L.append("## Dataset\n")
L.append(f"- {S['segments']} required segments: {S['by_city']} (manifest lists the 4 candidate streets excluded and why).")
L.append(f"- {S['outputs']} outputs, {S['labelled']} labelled, {S['excluded']} excluded: **{S['positives']} VALID**, **{S['negatives']} CONSTRAINT_UNSATISFIED**.")
L.append(f"- Positives by source: {S['positives_by_kind']}.")
L.append(f"- Negatives by source: {S['negatives_by_kind']}.\n")
L.append("## Raw distributions\n")
L.append("| Metric | VALID range | CONSTRAINT_UNSATISFIED range |")
L.append("|---|---|---|")
for k,lbl in [('req_to_out_max_m','required→output max (m)'),('req_to_out_p95_m','required→output p95 (m)'),('out_to_req_max_m','output→required max (m)'),('out_to_req_p95_m','output→required p95 (m)'),('hausdorff_m','Hausdorff (m)'),('backtrack_m','backtracking (m)'),('unmatched_points','provider-unmatched points')]:
    L.append(f"| {lbl} | {rng([x.get(k) for x in pos])} | {rng([x.get(k) for x in neg])} |")
L.append(f"| forward progress / segment length | {rng([round(x['forward_progress_m']/x['req_len_m'],4) for x in pos])} | {rng([round(x['forward_progress_m']/x['req_len_m'],4) for x in neg])} |")
L.append(f"| output / segment length | {rng([round(x['out_len_m']/x['req_len_m'],3) for x in pos])} | {rng([round(x['out_len_m']/x['req_len_m'],3) for x in neg])} |\n")
L.append("Reversed outputs coincide with the segment geometrically (Hausdorff ≈ 0) and are separated only by order; partial outputs lie on the segment (output→required ≈ 0) and are separated only by coverage.\n")
E=P['evidence']
L.append("## Policy `traversal-validator-v1`\n")
L.append("VALID only when all hold; otherwise CONSTRAINT_UNSATISFIED (an empty output fails):\n")
L.append(f"1. **Coverage**: max distance required→output ≤ **{P['max_required_to_output_m']} m** — VALID max {E['coverage']['positive_max']} m; nearest non-covering negative {E['coverage']['negative_min']} m; threshold = gap midpoint floored to 0.1 m.")
L.append(f"2. **On-segment**: max distance output→required ≤ **{P['max_output_to_required_m']} m** — VALID max {E['on_segment']['positive_max']} m (an endpoint overshoot into the junction); nearest negative that structurally leaves the required ways {E['on_segment']['negative_min']} m; gap midpoint floored to 0.1 m.")
L.append(f"3. **Order**: forward progress > 0 — VALID min ratio {E['forward_ratio']['positive_min']}; reversed max {E['forward_ratio']['negative_max_reversed']}; the sign is the natural boundary.")
L.append(f"4. **No material backtracking**: backtracking ≤ the coverage tolerance ({P['max_backtrack_m']} m) — VALID max {E['backtrack_m']['positive_max']} m; reversed min {E['backtrack_m']['negative_min_reversed']} m. Not an independent number: it reuses condition 1.")
L.append(f"5. **Unmatched provider points** ≤ {P['max_unmatched_points']} — VALID max {E['unmatched_points']['positive_max']}; {E['unmatched_points']['note']}.\n")
L.append("Flooring each midpoint moves the boundary toward the positives (fail-closed).\n")
L.append("## Results\n")
L.append(f"- False positives: **{len(S['false_positives'])}** {S['false_positives'] or ''}")
L.append(f"- False negatives: **{len(S['false_negatives'])}** {S['false_negatives'] or ''}")
L.append(f"- Rejecting conditions over negatives: {S['rejection_conditions']}. On-segment is never the sole rejecting condition in this dataset; it is kept as the guard for an output that covers the segment but also leaves it (not reproducible structurally here).")
L.append("- San Telmo (BA-00, Defensa Chile → Humberto I): " + "; ".join(f"{x['output_id']} {x['classified']} (req→out {x['req_to_out']} m, out→req {x['out_to_req']} m)" for x in S['san_telmo']))
L.append("\n| Provider | VALID | NEG | VALID req→out max | VALID out→req max | FP | FN |")
L.append("|---|---|---|---|---|---|---|")
for k,v in S['per_provider'].items(): L.append(f"| {k} | {v['positives']} | {v['negatives']} | {v['pos_req_to_out_max']} | {v['pos_out_to_req_max']} | {v['false_positives']} | {v['false_negatives']} |")
L.append("\n## Provider findings\n")
mm_fail=[x for x in rows if x['kind']=='REQUIRED' and x['gt']=='CONSTRAINT_UNSATISFIED']
L.append("Map matching of the *required* trace that did not follow it (correctly rejected by the validator):\n")
for x in mm_fail: L.append(f"- `{x['output_id']}` ({x['street']}): out→req {x['out_to_req_max_m']} m, required nodes covered {x['gt_evidence']['required_nodes_owned']}.")
L.append("\nBoth providers fail on exactly the same three Paris segments, so the cause is the required geometry, not a provider: PA-07's chain (built by name) includes separately mapped `highway=cycleway` ways named \"Rue Saint-Antoine\", which pedestrians cannot use; PA-01 and PA-04 include `highway=pedestrian` + `oneway=yes` ways that both routing graphs treat as one-way for walking. Ground truth labels these outputs CONSTRAINT_UNSATISFIED and the validator rejects them. Consequence for composition: a bounded traversal must be built only from ways the requested mode may traverse in the required direction.")
L.append("\n## Negative-control coverage\n")
L.append("- endpoint-only route on another street/path: ENDPOINT outputs labelled CONSTRAINT_UNSATISFIED;\n- parallel street: PARALLEL;\n- partial traversal: PARTIAL;\n- reversed traversal: REVERSED;\n- off-segment deviation in the middle with correct start/end: DETOUR;\n- off-segment excursion while still covering the whole segment: **not reproduced structurally**;\n- provider output with unmatched portions: **not reproduced** (no provider reported unmatched points on any output).\n")
L.append("## Limitations\n")
L.append("- One provider snapshot date; OSM drift between the catalog and a provider's graph can raise positive deviations and is handled fail-closed (CONSTRAINT_UNSATISFIED).")
L.append("- The on-segment margin is the narrowest (positives up to 3.08 m from a junction overshoot); thresholds must be recalibrated with a new dataset version if providers or geometry sources change.")
L.append("- Walking only (product scope); drive/bicycle traversals of pedestrian segments are expected to be unavailable or unsatisfied.")
open(os.path.join(ROOT,'README.md'),'w').write("\n".join(L)+"\n")
print('ok')
