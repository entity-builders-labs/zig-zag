"""Must-include UNKNOWN check: the lowest-desirability UNKNOWN-hours candidate of each city is declared must-include on the
normal 3-day ~30 pool; it must be scheduled under the final ρ and under an extreme ρ, in profiles A and B.
Writes ../runs/must_unknown.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calib, common as C   # noqa: E402

rows = []
for city in ('BA', 'PA', 'LA'):
    base = C.Problem(city, 30, 3)
    x = min((i for i in range(base.n) if base.unc[i] and base.cands[i]['kind'] == 'SINGLE'), key=lambda i: (base.cands[i]['desirability'], base.cands[i]['id']))
    must = base.cands[x]['id']
    for rho in (0.1, 0.8):
        for prof in ('A', 'B'):
            r = calib.run_one((city, 'S1-must-unknown', dict(pool_size=30, days=3, must=(must,), modes=calib.PROFILES[prof]), prof,
                               dict(K=120, cd=1, A=10, rho=rho, name=f'rho{rho}'), 1))
            ok = r['status'] == 'PLANNED' and must in r['selected'] and not r['violations']
            rows.append({'city': city, 'must': must, 'uMust': round(base.cands[x]['desirability'], 3), 'rho': rho, 'profile': prof,
                         'status': r['status'], 'scheduled': must in r['selected'], 'violations': r['violations'], 'pass': ok})
            print(rows[-1])
json.dump(rows, open(os.path.join(calib.PD7, 'runs', 'must_unknown.json'), 'w'), indent=1)
print('PASS' if all(r['pass'] for r in rows) else 'FAIL')
