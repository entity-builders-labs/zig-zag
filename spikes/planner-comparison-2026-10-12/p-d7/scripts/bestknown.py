"""Objective-level evaluation robust to search noise: for each policy q and scenario, take the best plan among ALL plans
found in a stage (any policy; hard constraints do not depend on the objective, so every plan is feasible for q) under
q's objective, then apply the stage-4 uncertainty criteria to these best-known plans.
Usage: python -I bestknown.py runs/<file>.json <ref-name> ; writes runs/<file>_bestknown.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crosseval as X   # noqa: E402  (objective(), loads the same file via argv; reuse its function only)

d = json.load(open(sys.argv[1])); ref = sys.argv[2]
key = X.key
plans = {}
for r in d['rows']:
    if r['status'] == 'PLANNED':
        plans.setdefault(key(r), []).append(r)
params = d['meta']['params']
best = {}
for prm in params:
    for k, rs in plans.items():
        best[(prm['name'],) + k] = max(rs, key=lambda r: (round(X.objective(r, prm), 6), -len(r['selected'])))
print('| policy | UNKNOWN visits (best-known, vs zero) | attractive UNKNOWN newly dropped | worst Σu retention (case) | verdict |')
print('|---|---|---|---|---|')
summary = []
for prm in params:
    ks = list(plans)
    unk = sum(best[(prm['name'],) + k]['unknownVisits'] for k in ks); unk0 = sum(best[(ref,) + k]['unknownVisits'] for k in ks)
    newly = [' '.join(k) for k in ks for _ in set(best[(prm['name'],) + k]['attractiveUnknownOmitted']) - set(best[(ref,) + k]['attractiveUnknownOmitted'])]
    rets = [(best[(prm['name'],) + k]['sumU'] / best[(ref,) + k]['sumU'], ' '.join(k)) for k in ks if best[(ref,) + k]['sumU']]
    w = min(rets)
    ok = unk / unk0 >= 0.8 and not newly
    summary.append({'policy': prm['name'], 'unknown': unk, 'unknownRatio': round(unk / unk0, 3), 'newlyDropped': newly,
                    'worstRetention': round(w[0], 4), 'worstCase': w[1], 'nonPathological': ok})
    print(f"| {prm['name']} | {unk} ({100 * unk / unk0:.0f} %) | {len(newly)} {sorted(set(newly))[:3]} | {100 * w[0]:.1f} % ({w[1]}) | {'non-pathological' if ok else 'PATHOLOGICAL'} |")
json.dump(summary, open(sys.argv[1].replace('.json', '_bestknown.json'), 'w'), indent=1)
