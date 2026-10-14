"""Stage 4 criteria (PROTOCOL.md "Uncertainty"): UNKNOWN visits vs the zero-penalty run, attractive UNKNOWN
candidates (u >= pool p75) newly dropped, must-include validity, worst desirability retention per city.
Usage: python -I unknown.py runs/stage4_unknown.json"""
import json, sys
d = json.load(open(sys.argv[1])); key = lambda r: (r['city'], r['scenario'], r['profile'])
base = {key(r): r for r in d['rows'] if r['params']['name'] == 'rho0'}
print('| policy | UNKNOWN visits (vs zero) | attractive UNKNOWN newly dropped | worst Σu retention (case) | must-include violations | verdict |')
print('|---|---|---|---|---|---|')
for p in d['meta']['params']:
    rs = [r for r in d['rows'] if r['params']['name'] == p['name'] and r['status'] == 'PLANNED']
    unk = sum(r['unknownVisits'] for r in rs); unk0 = sum(base[key(r)]['unknownVisits'] for r in rs)
    newly = []
    for r in rs:
        for x in set(r['attractiveUnknownOmitted']) - set(base[key(r)]['attractiveUnknownOmitted']):
            newly.append(f"{r['city']} {r['scenario']} {r['profile']}")
    worst = min(rs, key=lambda r: r['sumU'] / base[key(r)]['sumU'] if base[key(r)]['sumU'] else 1)
    wret = worst['sumU'] / base[key(worst)]['sumU']
    mustv = sum(len(r['violations']) for r in rs if r['scenario'] == 'S4-mustinclude')
    ok = unk / unk0 >= 0.8 and not newly and mustv == 0
    print(f"| {p['name']} | {unk} ({100 * unk / unk0:.0f} %) | {len(newly)} {sorted(set(newly))[:3]} | {100 * wret:.1f} % ({worst['city']} {worst['scenario']} {worst['profile']}) | {mustv} | {'non-pathological' if ok else 'PATHOLOGICAL'} |")
