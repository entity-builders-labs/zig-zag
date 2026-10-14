"""Search gap of a policy's own SL1000 plans: for each scenario, compare the policy's objective on its own plan with the
best objective (under the same policy) among all plans found in the given run files (feasible for every policy).
Usage: python -I solvergap.py <policy-name> <params-json> runs/a.json [runs/b.json ...]"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crosseval as X   # noqa: E402

name, prm = sys.argv[1], json.loads(sys.argv[2])
plans, own = {}, {}
for f in sys.argv[3:]:
    for r in json.load(open(f))['rows']:
        if r['status'] != 'PLANNED':
            continue
        if r['params']['name'] == name and f == sys.argv[3]:
            own[X.key(r)] = r
        if set(r['params'].get('modes', [])) or True:
            plans.setdefault(X.key(r), []).append(r)
rows = []
for k, r in own.items():
    mine = X.objective(r, prm); best = max(X.objective(p, prm) for p in plans[k])
    rows.append({'case': ' '.join(k), 'own': round(mine, 1), 'bestKnown': round(best, 1), 'gap': round(best - mine, 1),
                 'gapPct': round(100 * (best - mine) / best, 2) if best > 0 else 0.0})
rows.sort(key=lambda x: -x['gapPct'])
gaps = [x['gapPct'] for x in rows]
print(f"{name}: scenarios {len(rows)}, own = best-known in {sum(g <= 0.005 for g in gaps)}, gap > 1 % in {sum(g > 1 for g in gaps)}, max {max(gaps):.2f} %")
for x in rows[:6]:
    print('  ', x)
json.dump(rows, open(os.path.join(os.path.dirname(sys.argv[3]), f'solvergap_{name}.json'), 'w'), indent=1)
