"""Record Geoapify Route Matrix mode=bicycle for the P11 fixture points (BA / PA / LA).

Same points, same order and same API as the recorded P11 walk/drive matrices
(../../scripts/record_travel.py), so the three modes are directly comparable.
Recorded once; analyses replay the files. Key from env (GEOAPIFY_API_KEY), never stored.
Writes only g-p7-b/fixtures/<city>_matrix_bicycle.json; never touches the P11 fixtures.
"""
import json, os, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE)
P11 = os.path.dirname(GATE)
KEY = os.environ['GEOAPIFY_API_KEY']
REQUEST = {'mode': 'bicycle'}  # Geoapify default bicycle profile ("A city bicycle"), type=balanced, metric

for city in ('BA', 'PA', 'LA'):
    out_path = os.path.join(GATE, 'fixtures', f'{city}_matrix_bicycle.json')
    if os.path.exists(out_path):
        print(city, 'exists, skipped'); continue
    # Reuse the exact point list recorded with the walk matrix (no re-derivation).
    walk = json.load(open(os.path.join(P11, 'fixtures', f'{city}_matrix_walk.json')))
    pts = walk['points']
    locs = [{'location': [p['lon'], p['lat']]} for p in pts]
    body = dict(REQUEST, sources=locs, targets=locs)
    req = urllib.request.Request('https://api.geoapify.com/v1/routematrix?apiKey=' + KEY,
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.load(r)
    ms = round((time.perf_counter() - t) * 1000)
    rows = out['sources_to_targets']
    M = {'provider': 'geoapify', 'api': 'routematrix', 'mode': 'bicycle',
         'request': {k: v for k, v in REQUEST.items()}, 'request_points': 'identical to ' + f'fixtures/{city}_matrix_walk.json',
         'retrieved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'latency_ms': ms,
         'credits_estimate': len(pts) * min(len(pts), 10),
         'points': pts,
         'time_s': [[c.get('time') for c in row] for row in rows],
         'distance_m': [[c.get('distance') for c in row] for row in rows]}
    json.dump(M, open(out_path, 'w'))
    print(city, len(pts), 'points', ms, 'ms; null pairs',
          sum(1 for i, r in enumerate(M['time_s']) for j, v in enumerate(r) if v is None and i != j))
    time.sleep(1)
