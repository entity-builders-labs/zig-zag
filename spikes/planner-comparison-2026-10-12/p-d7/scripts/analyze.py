"""Summaries of calibration stage outputs. Usage: python -I analyze.py <runs/file.json> <ref-param-name> [group-by]
Retention = Σu(policy) / Σu(reference policy) per (city, scenario, profile)."""
import json, statistics as st, sys
from collections import defaultdict

data = json.load(open(sys.argv[1])); ref = sys.argv[2]
rows = [r for r in data['rows'] if r['status'] == 'PLANNED']
key = lambda r: (r['city'], r['scenario'], r['profile'])
refs = {key(r): r for r in rows if r['params']['name'] == ref}
by = defaultdict(list)
for r in rows:
    by[r['params']['name']].append(r)
print(f"| policy | violations | retention Σu mean / worst | travel vs ref | scheduled (sum) | drive legs | short hops | UNKNOWN visits | attractive-UNKNOWN omitted | identical repeats |")
print('|---|---|---|---|---|---|---|---|---|---|')
out = {}
for name in [p['name'] for p in data['meta']['params']]:
    rs = by[name]; ret = []; trv = []
    for r in rs:
        b = refs.get(key(r))
        if b and b['sumU'] > 0: ret.append(r['sumU'] / b['sumU'])
        if b and b['travelMin'] > 0: trv.append(r['travelMin'] / b['travelMin'])
    worst = min(ret); wk = min((r for r in rs if refs.get(key(r))), key=lambda r: r['sumU'] / refs[key(r)]['sumU'])
    s = {'violations': sum(len(r['violations']) for r in rs), 'retMean': round(100 * st.mean(ret), 2), 'retWorst': round(100 * worst, 2),
         'worstCase': f"{wk['city']} {wk['scenario']} {wk['profile']}", 'travelRatio': round(st.mean(trv), 3),
         'scheduled': sum(r['scheduled'] for r in rs), 'driveLegs': sum(r['driveLegs'] for r in rs), 'shortHops': sum(r['shortHopDrive'] for r in rs),
         'unknown': sum(r['unknownVisits'] for r in rs), 'attrUnknownOmitted': sum(len(r['attractiveUnknownOmitted']) for r in rs),
         'identical': f"{sum(r['identicalRepeats'] for r in rs)}/{len(rs)}"}
    out[name] = s
    print(f"| {name} | {s['violations']} | {s['retMean']} % / {s['retWorst']} % ({s['worstCase']}) | {s['travelRatio']:.2f} | {s['scheduled']} | {s['driveLegs']} | {s['shortHops']} | {s['unknown']} | {s['attrUnknownOmitted']} | {s['identical']} |")
if len(sys.argv) > 3 and sys.argv[3] == 'cities':
    print()
    for name in out:
        for city in ('BA', 'PA', 'LA'):
            rs = [r for r in by[name] if r['city'] == city]
            ret = [r['sumU'] / refs[key(r)]['sumU'] for r in rs if refs.get(key(r))]
            print(f"{name} {city} ret mean {100 * st.mean(ret):.1f} worst {100 * min(ret):.1f} travel {sum(r['travelMin'] for r in rs):.0f} min sched {sum(r['scheduled'] for r in rs)} driveLegs {sum(r['driveLegs'] for r in rs)} unknown {sum(r['unknownVisits'] for r in rs)}")
json.dump(out, open(sys.argv[1].replace('.json', '_summary.json'), 'w'), indent=1)
