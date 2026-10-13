"""G-P5 stop-policy experiments on every P11 scenario (BA/PA/LA x 13), scored with the recorded P11
checker and metrics and compared with the recorded P11 Routing and greedy best-insertion runs.
Writes ../runs/stop_policies.json. Usage: python -I stop_policies.py [policy ...]"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build_request as B   # noqa: E402  (sets sys.path for P11 scripts and the sidecar)
import common as C, run_all as RA, adapter as A   # noqa: E402

G = dict(first='PATH_CHEAPEST_ARC', meta='GUIDED_LOCAL_SEARCH')
POLICIES = {
    'T1000': (dict(G, time_cap_ms=1000), 2),            # wall-clock only (P11 style), for reference
    'T5000': (dict(G, time_cap_ms=5000), 1),
    'GD': (dict(first='PATH_CHEAPEST_ARC', meta='GREEDY_DESCENT', time_cap_ms=30000), 3),
    'IMP-1-100': (dict(G, improvement=(1.0, 100), time_cap_ms=30000), 3),
    'IMP-10-100': (dict(G, improvement=(10.0, 100), time_cap_ms=30000), 3),
    **{f'SL{n}': (dict(G, solution_limit=n, time_cap_ms=30000), 3) for n in (100, 250, 500, 1000, 2000)},
}
SUMMARY = json.load(open(os.path.join(B.SPIKE, 'runs', 'summary.json')))['rows']


def recorded(city, scen):
    out = {}
    for r in SUMMARY:
        if r['city'] == city and r['scenario'] == scen and (r['solver'].startswith('routing') or r['solver'] == 'greedy-insertion'):
            out[r['solver']] = {'obj': r['objective_test_weights'], 'scheduled': r['scheduled'], 'status': r['status']}
    return out


def main(names):
    rows = []
    for city in ('BA', 'PA', 'LA'):
        for sname, kw in RA.scenarios(city):
            P = C.Problem(city, name=sname, **kw)
            req = B.request_from_problem(P)
            rec = recorded(city, sname)
            for pname in names:
                pol, reps = POLICIES[pname]
                outs = [A.solve(req, pol) for _ in range(reps)]
                r = outs[0]; plan = B.plan_from_result(P, r); met = C.metrics(P, plan); viol = C.check(P, plan)
                sig = [json.dumps(o.get('days'), sort_keys=True) for o in outs]
                row = {'city': city, 'scenario': sname, 'policy': pname, 'status': r['status'],
                       'solverStatus': r['optimizer'].get('solverStatus'), 'scheduled': met['scheduled'],
                       'obj': met['objective_test_weights'], 'violations': viol, 'identical_repeats': len(set(sig)) == 1,
                       'reps': reps, 'solveMs': [o['timings'].get('solveMs') for o in outs],
                       'solutions': r['optimizer'].get('solutionsGenerated'),
                       'capHit': r['optimizer'].get('solverStatus') == 'ROUTING_FAIL_TIMEOUT' or (
                           pol.get('time_cap_ms', 0) >= 30000 and max(o['timings'].get('solveMs') or 0 for o in outs) >= 29000),
                       'conflicts': r.get('conflicts'), 'mustIncludeUnplaced': r.get('mustIncludeUnplaced'), 'recorded': rec}
                rows.append(row)
                print(city, sname, pname, row['status'], row['scheduled'], row['obj'], 'viol', len(viol),
                      'same' if row['identical_repeats'] else 'DIFF', row['solveMs'], file=sys.stderr, flush=True)
    import ortools
    out = {'meta': {'ortools': ortools.__version__, 'python': sys.version.split()[0], 'adapter': A.ADAPTER_VERSION,
                    'machine': 'Apple M1 Pro, 10 cores, 32 GB (developer laptop)', 'objective': B.OBJECTIVE_POLICY,
                    'policies': {k: v[0] for k, v in POLICIES.items() if k in names}}, 'rows': rows}
    path = os.path.join(os.path.dirname(HERE), 'runs', f'stop_policies{"-" + os.environ["TAG"] if os.environ.get("TAG") else ""}.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:] or list(POLICIES))
