"""Task 40.2 — structural under/over-estimation analysis for a GLOBAL_DEFAULT visit-duration fallback.

This is NOT a calibration: there is no evidence-backed typical-duration sample (see ../README.md), so no
fallback value is chosen here. It answers the 3C question of what each direction of error costs, using
the P11 fixtures and the unchanged G-P5 adapter (routing-gls-sl1000-v1):

  For a candidate fallback F, every VISIT component is planned at F minutes (TRAVERSE time and composite
  internal legs keep their routed values; fallback never applies to them). Then:
  - overestimation cost: Experiences scheduled at F vs at smaller F (utilization lost);
  - underestimation tolerance: the largest uniform error e such that the SAME plan (same days, order,
    modes, legs) still satisfies every KNOWN opening window, day window and end anchor when each VISIT
    component really takes F·(1 + e). A small e* means the plan breaks as soon as visits run long.

Objective: the G-P7-U.B check point with the test-only preference annotation (../../g-p7-u-b/scripts/
tours.py), WALK+DRIVE, scenarios S1 (3 days) and S5 (1-day oversupply), BA / PA / LA.
"""
import json, math, os, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE); SPIKE = os.path.dirname(GATE)
sys.path.insert(0, os.path.join(SPIKE, 'g-p7-u-b', 'scripts'))
import tours as T   # noqa: E402  (also puts the P11 / G-P5 / P-D7 modules on the path)
import adapter as AD   # noqa: E402

FALLBACKS = (30, 45, 60, 75, 90, 120)
SCEN = ('S1-normal-pall', 'S5-oversupply-1day')
MODES = ('walk', 'drive')


def with_visit_minutes(P, minutes):
    for c in P.cands:
        for k in P.visit_components(c):
            k['duration_min'] = minutes
    P._prep()
    return P


def replay_ok(city, scen, plan, minutes):
    """Does the fixed plan stay feasible if every VISIT component takes `minutes`?"""
    P = with_visit_minutes(T.problem(city, scen, MODES), minutes)
    idx = {c['id']: i for i, c in enumerate(P.cands)}
    h = P.pidx['HOTEL']
    for d, day in enumerate(plan):
        t = P.window[0]
        if P.start_anchor and day['items']:
            first = day['items'][0]
            t += math.ceil(first['incoming']['seconds'] / 60 - 1e-9) if first['incoming'] else 0
        for k, it in enumerate(day['items']):
            i = idx[it['experienceId']]
            if k:
                t += math.ceil(it['incoming']['seconds'] / 60 - 1e-9)
            starts = [max(t, a) for a, b in P.ivs[i][d] if max(t, a) <= b]
            if not starts:
                return False
            t = min(starts) + P.service[i]
        if day['items'] and P.end_anchor and day.get('outgoingToEnd'):
            t += math.ceil(day['outgoingToEnd']['seconds'] / 60 - 1e-9)
        if t > P.window[1] + 1e-9:
            return False
    return True


def run_one(args):
    city, scen, F = args
    P = with_visit_minutes(T.problem(city, scen, MODES), F)
    req, cls, prize = T.build(P, T.SIMPLE, MODES)
    res = AD.solve(req)
    plan = res.get('days') or []
    n = sum(len(d['items']) for d in plan)
    lo, hi = 0.0, 3.0   # bisection on the uniform relative error e (plan breaks somewhere in (lo, hi])
    if replay_ok(city, scen, plan, F * (1 + hi)):
        e_star = hi
    else:
        for _ in range(14):
            mid = (lo + hi) / 2
            if replay_ok(city, scen, plan, F * (1 + mid)): lo = mid
            else: hi = mid
        e_star = lo
    return {'city': city, 'scenario': scen, 'fallbackMinutes': F, 'status': res['status'], 'scheduled': n,
            'violations': T.CAL.validate(req, res) if res['status'] == 'PLANNED' else [],
            'underestimateTolerance': round(e_star, 3), 'toleranceMinutesPerVisit': round(F * e_star, 1),
            'stopReason': res['optimizer'].get('stopReason')}


def main():
    tasks = [(c, s, F) for c in ('BA', 'PA', 'LA') for s in SCEN for F in FALLBACKS]
    with Pool(8) as pool:
        rows = pool.map(run_one, tasks, chunksize=1)
    os.makedirs(os.path.join(GATE, 'runs'), exist_ok=True)
    json.dump({'meta': {'fallbacks': FALLBACKS, 'scenarios': SCEN, 'modes': MODES, 'objective': T.SIMPLE,
                        'note': 'structural analysis only; no fallback value is chosen'}, 'rows': rows},
              open(os.path.join(GATE, 'runs', 'fallback_loss.json'), 'w'), indent=1)
    for r in rows:
        print(r['city'], r['scenario'], r['fallbackMinutes'], r['status'], r['scheduled'], 'tol', r['underestimateTolerance'],
              f"(+{r['toleranceMinutesPerVisit']} min/visit)", r['violations'])


if __name__ == '__main__':
    main()
