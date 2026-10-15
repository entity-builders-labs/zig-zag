"""G-P7-U.B / G-P7-B — Tour-level validation of the judgment-derived region with OR-Tools.

Runs the unchanged G-P5 adapter (routing-gls-sl1000-v1) on the P11 fixtures (BA / PA / LA) with
the recorded Geoapify WALK / DRIVE matrices and the recorded BICYCLE matrices (../g-p7-b/fixtures),
under the objective family of judgments.py:

  prize_i = K · v_i / max v      v_i = D_i + β·I_i + γ·r_i      (× (1 − ρ·f_i))
  leg cost = c_m · minutes + A_m  (WALK: 1 per minute, no friction)

TEST-ONLY preference annotation (not product data, not a ranking): each fixture candidate gets a
deterministic preference class from a hash of its id — DIRECT strong / medium / weak, INFERRED
(importance 1.0 or 0.7 × confidence 0.5-1.0), or no explicit match — and r_i = fixture desirability
rank in [0, 1] as a stand-in for the soft-anchor/semantic/quality refinement. The same rule applies in
every city; no city-specific value exists. Every plan is validated independently (p-d7 validator).
"""
import hashlib, json, math, os, sys, time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE); SPIKE = os.path.dirname(GATE)
sys.path.insert(0, os.path.join(SPIKE, 'scripts')); sys.path.insert(0, os.path.join(SPIKE, 'g-p5', 'sidecar'))
sys.path.insert(0, os.path.join(SPIKE, 'p-d7', 'scripts'))
import common as C, run_all as RA   # noqa: E402  (P11, read-only)
import adapter as AD                # noqa: E402  (G-P5, read-only)
import calib as CAL                 # noqa: E402  (P-D7 independent validator, read-only)

SCALE = 10
POLICY = 'routing-gls-sl1000-v1'
PROFILES = {'A_WALK': ('walk',), 'B_WALK_DRIVE': ('walk', 'drive'), 'D_WALK_BICYCLE': ('walk', 'bicycle'),
            'E_WALK_DRIVE_BICYCLE': ('walk', 'drive', 'bicycle'), 'F_BICYCLE': ('bicycle',)}
SCEN = ('S1-normal-pall', 'S2-tight-hours', 'S5-oversupply-1day', 'S9-anchors-startend-p20')
# 'proposed': the 2026-10-14 check point (runs/*.json); 'adopted': the owner-adopted initial policy of
# 2026-10-15 (D1 c_DRIVE = 1, D2 c_BICYCLE = 1, A_BICYCLE = 4.5) → runs/*_adopted.json. Select with
# GP7UB_POINT=adopted; the default reproduces the 2026-10-14 runs unchanged.
POINTS = {'proposed': {'K': 100.0, 'b': 0.2, 'g': 0.12, 'cd': 1.0, 'Ad': 11.0, 'cb': 0.6, 'Ab': 6.0, 'rho': 0.15},
          'adopted': {'K': 100.0, 'b': 0.2, 'g': 0.12, 'cd': 1.0, 'Ad': 11.0, 'cb': 1.0, 'Ab': 4.5, 'rho': 0.15}}
POINT = os.environ.get('GP7UB_POINT', 'proposed')
SIMPLE = POINTS[POINT]
SUFFIX = '' if POINT == 'proposed' else f'_{POINT}'
SHORT_WALK = 10   # a vehicle leg replacing a walk of ≤ 10 min is reported as a short hop (diagnostic only)


def pref_class(cid):
    h = int(hashlib.sha1(cid.encode()).hexdigest(), 16)
    x, conf = h % 100, 0.5 + ((h // 100) % 51) / 100
    if x < 15: return 'DIRECT', 1.0, 0.0
    if x < 27: return 'DIRECT', 0.7, 0.0
    if x < 35: return 'DIRECT', 0.5, 0.0
    if x < 45: return 'INFERRED', 0.0, round(1.0 * conf, 3)
    if x < 55: return 'INFERRED', 0.0, round(0.7 * conf, 3)
    return 'NONE', 0.0, 0.0


def problem(city, scen, modes):
    kw = dict(dict(RA.scenarios(city))[scen]); kw['modes'] = tuple(m for m in modes if m != 'bicycle') or ('walk',)
    P = C.Problem(city, name=scen, **kw)
    P.M['bicycle'] = json.load(open(os.path.join(SPIKE, 'g-p7-b', 'fixtures', f'{city}_matrix_bicycle.json')))
    assert [p['pid'] for p in P.M['bicycle']['points']] == [p['pid'] for p in P.M['walk']['points']]
    return P


def build(P, prm, modes):
    n = P.n
    order = sorted(range(n), key=lambda i: (P.cands[i]['desirability'], P.cands[i]['id']))
    r = [0.0] * n
    for k, i in enumerate(order):
        r[i] = k / (n - 1) if n > 1 else 1.0
    cls = [pref_class(c['id']) for c in P.cands]
    v = [D + prm['b'] * I + prm['g'] * r[i] for i, (_, D, I) in enumerate(cls)]
    vmax = max(v)
    vis = [len(P.visit_components(c)) for c in P.cands]
    prize = [prm['K'] * v[i] / vmax for i in range(n)]
    util = [round(SCALE * prize[i] * (1 - prm['rho'] * P.unc[i] / vis[i])) for i in range(n)]
    # Constrained TRAVERSE is mode-specific (design C16, G2): the recorded San Telmo traversal is valid on
    # foot only; the recorded DRIVE and BICYCLE outputs leave Defensa (CONSTRAINT_UNSATISFIED). Without
    # WALK the composite has no validated estimate -> REQUIRED_TRAVERSAL_UNSATISFIED, never walk-timed.
    unsat = {c['id'] for c in P.cands if c['kind'] == 'COMPOSITE' and 'walk' not in modes}
    h = P.pidx['HOTEL']
    tc = {'WALK': {'perMinute': SCALE * 1, 'perLeg': 0}, 'DRIVE': {'perMinute': SCALE * prm['cd'], 'perLeg': SCALE * prm['Ad']},
          'BICYCLE': {'perMinute': SCALE * prm['cb'], 'perLeg': SCALE * prm['Ab']}}
    req = {
        'contractVersion': 'planning-problem-v1', 'requestId': f'{P.city}:{P.name}',
        'days': [{'date': d, 'window': {'start': P.window[0], 'end': P.window[1]},
                  'startPoint': h if P.start_anchor else None, 'endPoint': h if P.end_anchor else None} for d in P.dates],
        'travel': {'points': [p['pid'] for p in P.M['walk']['points']], 'modes': [m.upper() for m in modes],
                   'seconds': {m.upper(): P.M[m]['time_s'] for m in modes}},
        'candidates': [{'id': c['id'], 'startPoint': P.point(c, False), 'endPoint': P.point(c, True),
                        'serviceMinutes': math.ceil(P.service[i] - 1e-9), 'utility': util[i], 'uncertainVisitComponents': 0,
                        'mustInclude': c['id'] in P.must,
                        'startWindowsByDay': [[] if c['id'] in unsat else [list(w) for w in P.ivs[i][d]]
                                              for d in range(len(P.dates))]}
                       for i, c in enumerate(P.cands)],
        'limits': {'maxContinuousWalkMinutes': P.limits['max_continuous_walk_min'],
                   'dailyWalkBudgetMinutes': P.limits['daily_walk_budget_min']},
        'requiredTraversalUnsatisfied': sorted(unsat),
        'objective': {'policyVersion': 'g-p7-u-b-test', 'openingHoursUncertaintyPenalty': 0,
                      'travelCost': {m.upper(): tc[m.upper()] for m in modes}},
        'optimizerPolicyVersion': POLICY,
    }
    return req, cls, prize


def evaluate(P, req, res, cls, prize, prm):
    """Objective-independent facts of a plan + its value under the parameter point prm (tme)."""
    idx = {c['id']: i for i, c in enumerate(P.cands)}
    W = P.M['walk']['time_s']
    m = {'scheduled': 0, 'DIRECT': 0, 'INFERRED': 0, 'NONE': 0, 'sumD': 0.0, 'sumI': 0.0, 'unknownVisits': 0,
         'minutes': {'WALK': 0.0, 'DRIVE': 0.0, 'BICYCLE': 0.0}, 'legs': {'WALK': 0, 'DRIVE': 0, 'BICYCLE': 0},
         'shortHops': {'DRIVE': 0, 'BICYCLE': 0}, 'forbiddenLegs': 0, 'selected': [], 'value': 0.0}
    if res['status'] != 'PLANNED':
        return m
    allowed = set(req['travel']['modes'])
    tcost = {'WALK': (1, 0), 'DRIVE': (prm['cd'], prm['Ad']), 'BICYCLE': (prm['cb'], prm['Ab'])}
    for d, day in enumerate(res['days']):
        prev = None; legs = []
        for it in day['items']:
            i = idx[it['experienceId']]; k, D, I = cls[i]
            m['scheduled'] += 1; m[k] += 1; m['sumD'] += D; m['sumI'] += I; m['unknownVisits'] += P.unc[i]
            m['selected'].append(it['experienceId'])
            vis = len(P.visit_components(P.cands[i]))
            m['value'] += prize[i] * (1 - prm['rho'] * P.unc[i] / vis)
            src = P.point(P.cands[idx[prev]], True) if prev else req['days'][d]['startPoint']
            if it['incoming'] and src is not None:
                legs.append((it['incoming'], src, P.point(P.cands[i], False)))
            prev = it['experienceId']
        if day['items'] and day.get('outgoingToEnd') and req['days'][d]['endPoint'] is not None:
            legs.append((day['outgoingToEnd'], P.point(P.cands[idx[prev]], True), req['days'][d]['endPoint']))
        for leg, a, b in legs:
            mode = leg['mode']; mins = leg['seconds'] / 60
            if mode not in allowed: m['forbiddenLegs'] += 1
            m['minutes'][mode] += mins; m['legs'][mode] += 1
            c_, a_ = tcost[mode]; m['value'] -= c_ * mins + (a_ if a != b else 0)
            if mode != 'WALK' and W[a][b] is not None and W[a][b] / 60 <= SHORT_WALK:
                m['shortHops'][mode] += 1
    m['travelMin'] = round(sum(m['minutes'].values()), 1)
    m['minutes'] = {k: round(v, 1) for k, v in m['minutes'].items()}
    m['value'] = round(m['value'], 2); m['sumD'] = round(m['sumD'], 2); m['sumI'] = round(m['sumI'], 2)
    return m


def run_one(args):
    city, scen, prof, label, prm, reps = args
    modes = PROFILES[prof]
    P = problem(city, scen, modes)
    req, cls, prize = build(P, prm, modes)
    outs = [AD.solve(req) for _ in range(reps)]
    res = outs[0]
    avail = {k: sum(1 for c in cls if c[0] == k) for k in ('DIRECT', 'INFERRED', 'NONE')}
    row = {'city': city, 'scenario': scen, 'profile': prof, 'label': label, 'params': prm, 'status': res['status'],
           'available': avail, 'poolN': P.n, 'poolUnknown': sum(1 for x in P.unc if x),
           **evaluate(P, req, res, cls, prize, prm),
           'violations': CAL.validate(req, res) if res['status'] == 'PLANNED' else [],
           'identicalRepeats': len({json.dumps(o.get('days') or o.get('conflicts'), sort_keys=True) for o in outs}) == 1,
           'solveMs': [o['timings'].get('solveMs') for o in outs], 'stopReason': res['optimizer'].get('stopReason'),
           'requiredTraversalUnsatisfied': req['requiredTraversalUnsatisfied'], 'plan': res.get('days')}
    return row


def param_sets():
    out = [('simple', dict(SIMPLE))]
    for k in ('K', 'b', 'g', 'Ad', 'cb', 'Ab', 'rho'):
        for f in (0.75, 1.33):
            q = dict(SIMPLE); q[k] = round(SIMPLE[k] * f, 4); out.append((f'{k}x{f}', q))
    return out


def main():
    tasks = []
    for label, prm in param_sets():
        for city in ('BA', 'PA', 'LA'):
            for scen in SCEN:
                for prof in PROFILES:
                    if prof in ('A_WALK', 'F_BICYCLE', 'D_WALK_BICYCLE') and label.startswith(('Ad', 'cd')):
                        continue   # DRIVE terms cannot matter without DRIVE
                    if 'BICYCLE' not in prof and label.startswith(('cb', 'Ab')):
                        continue
                    tasks.append((city, scen, prof, label, prm, 2 if label == 'simple' else 1))
    t0 = time.time()
    with Pool(8) as pool:
        rows = pool.map(run_one, tasks, chunksize=1)
    json.dump({'meta': {'policy': POLICY, 'scale': SCALE, 'point': POINT, 'simple': SIMPLE, 'profiles': PROFILES, 'scenarios': SCEN,
                        'wall_s': round(time.time() - t0, 1), 'annotation': 'test-only hash classes, see module docstring'},
               'rows': rows}, open(os.path.join(GATE, 'runs', f'tours{SUFFIX}.json'), 'w'))
    print('runs', len(rows), 'wall', round(time.time() - t0, 1), 's')


if __name__ == '__main__':
    main()
