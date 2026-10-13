"""Benchmark cases for the end-to-end measurements (realistic ~30-candidate, 3-day requests on the P11
fixtures) plus the Python-built request of each, used to prove the Node builder emits the identical request.
Also scores greedy best-insertion on each case for the operational comparison. Writes ../runs/bench_cases.json."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build_request as B   # noqa: E402
import common as C, run_all as RA, planners as PL   # noqa: E402


def cases():
    base = C.Problem('BA', 30, 3)
    must = [base.cands[RA.pick_must(base, 'low_known')]['id'], base.cands[RA.pick_must(base, 'farthest')]['id']]
    out = [
        ('BA-G5-full', 'BA', dict(pool_size=30, days=3, must=tuple(must), start_anchor=True, end_anchor=True)),
        ('BA-S1-normal-pall', 'BA', dict(pool_size=30, days=3)),
        ('PA-S1-normal-pall', 'PA', dict(pool_size=30, days=3)),
        ('LA-S1-normal-pall', 'LA', dict(pool_size=30, days=3)),
    ]
    cw = RA.closed_window_must('BA')
    out.append(('BA-S8-infeasible-must-closed', 'BA', dict(pool_size=30, days=1, window=(cw[0] + 60, min(cw[0] + 240, 1430)), must=(cw[1],))))
    return out


def main():
    rows = []
    for name, city, kw in cases():
        P = C.Problem(city, name=name, **kw)
        req = B.request_from_problem(P, request_id=name)
        g = PL.greedy_insertion(P); gm = C.metrics(P, g)
        rows.append({'name': name, 'city': city,
                     'cfg': {'poolSize': kw['pool_size'], 'days': kw['days'], 'window': list(kw.get('window', P.window)),
                             'must': list(kw.get('must', ())), 'startAnchor': kw.get('start_anchor', False),
                             'endAnchor': kw.get('end_anchor', False), 'requestId': name},
                     'candidates': P.n, 'pairEdges': P.edge_count(),
                     'greedyInsertion': {'obj': gm['objective_test_weights'], 'scheduled': gm['scheduled'],
                                         'violations': C.check(P, g), 'wallMs': round(g['meta']['wall_s'] * 1000, 1),
                                         'mustConflicts': g['meta']['must_conflicts']},
                     'pythonRequest': req})
        print(name, P.n, gm['scheduled'], gm['objective_test_weights'], file=sys.stderr)
    json.dump(rows, open(os.path.join(os.path.dirname(HERE), 'runs', 'bench_cases.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
