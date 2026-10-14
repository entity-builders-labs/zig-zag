"""P-D7 calibration library (see ../PROTOCOL.md). Builds planning-problem-v1 requests from the P11 fixtures
under a candidate objective, solves them with the unchanged G-P5 OR-Tools adapter (routing-gls-sl1000-v1),
validates every plan independently and scores it in objective-independent units (minutes, desirability).

Objective (unit = travel-minute equivalent, tme; one walking minute = 1):
  Σ K·u_i·(1 − ρ·f_i) − P·Σ uncertain VISIT components − Σ walk minutes − Σ (c_d·drive minutes + A)
"""
import json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); PD7 = os.path.dirname(HERE); SPIKE = os.path.dirname(PD7)
sys.path.insert(0, os.path.join(SPIKE, 'scripts')); sys.path.insert(0, os.path.join(SPIKE, 'g-p5', 'sidecar'))
import common as C, run_all as RA   # noqa: E402  (P11 fixtures/scenarios, read-only)
import adapter as A_   # noqa: E402  (G-P5 adapter, read-only)

SCALE = 10   # integer precision for the solver (tme × 10)
POLICY = 'routing-gls-sl1000-v1'
PROFILES = {'A': ('walk',), 'B': ('walk', 'drive'), 'C': ('drive',)}
SCEN = ('S1-normal-pall', 'S2-tight-hours', 'S5-oversupply-1day', 'S9-anchors-startend-p20', 'S4-mustinclude')
SHORT_WALK_MIN = 10


def problems(city, scen=SCEN):
    out = []
    for name, kw in RA.scenarios(city):
        if name in scen:
            out.append((name, kw))
    return out


def build(P, prm, modes):
    h = P.pidx['HOTEL']
    dmax = max(c['desirability'] for c in P.cands)
    u = [c['desirability'] / dmax for c in P.cands]                 # per-request max normalization
    vis = [len(P.visit_components(c)) for c in P.cands]
    K, rho, Pabs = prm['K'], prm.get('rho', 0.0), prm.get('P', 0.0)
    util = [round(SCALE * (K * u[i] * (1 - rho * P.unc[i] / vis[i]) - Pabs * P.unc[i])) for i in range(P.n)]
    req = {
        'contractVersion': 'planning-problem-v1', 'requestId': f'{P.city}:{P.name}',
        'days': [{'date': d, 'window': {'start': P.window[0], 'end': P.window[1]},
                  'startPoint': h if P.start_anchor else None, 'endPoint': h if P.end_anchor else None} for d in P.dates],
        'travel': {'points': [p['pid'] for p in P.M['walk']['points']], 'modes': [m.upper() for m in modes],
                   'seconds': {m.upper(): P.M[m]['time_s'] for m in modes}},
        'candidates': [{'id': c['id'], 'startPoint': P.point(c, False), 'endPoint': P.point(c, True),
                        'serviceMinutes': math.ceil(P.service[i] - 1e-9), 'utility': util[i],
                        'uncertainVisitComponents': 0,   # uncertainty already folded into utility above
                        'mustInclude': c['id'] in P.must,
                        'startWindowsByDay': [[list(w) for w in P.ivs[i][d]] for d in range(len(P.dates))]}
                       for i, c in enumerate(P.cands)],
        'limits': {'maxContinuousWalkMinutes': P.limits['max_continuous_walk_min'],
                   'dailyWalkBudgetMinutes': P.limits['daily_walk_budget_min']},
        'objective': {'policyVersion': prm.get('name', 'calibration'), 'openingHoursUncertaintyPenalty': 0,
                      'travelCost': {'WALK': {'perMinute': SCALE * 1, 'perLeg': 0},
                                     'DRIVE': {'perMinute': SCALE * prm['cd'], 'perLeg': SCALE * prm['A']}}},
        'optimizerPolicyVersion': POLICY,
    }
    return req, u


def validate(req, res):
    """Independent hard-constraint check of a planning-result-v1 (port of g-p5/client/validate.mjs)."""
    v = []; cands = {c['id']: c for c in req['candidates']}; seen = set(); lim = req['limits']
    for d, day in enumerate(res['days']):
        rd = req['days'][d]; walk = 0.0; prev = None; items = day['items']
        for k, it in enumerate(items):
            c = cands[it['experienceId']]
            if c['id'] in seen: v.append('dup')
            seen.add(c['id'])
            if not any(a <= it['start'] <= b for a, b in c['startWindowsByDay'][d]): v.append(f"{c['id']} window")
            legs = []
            if prev is not None: legs.append((it['incoming'], prev['endPoint'], c['startPoint'], prev['end']))
            elif rd['startPoint'] is not None: legs.append((it['incoming'], rd['startPoint'], c['startPoint'], rd['window']['start']))
            for leg, a, b, t0 in legs:
                if not leg or leg['mode'] not in req['travel']['modes']: v.append('FORBIDDEN_OR_MISSING_MODE'); continue
                s = req['travel']['seconds'][leg['mode']][a][b]
                if s is None or s != leg['seconds']: v.append('leg estimate mismatch'); continue
                if it['start'] < t0 + math.ceil(s / 60 - 1e-9): v.append('travel-time')
                if leg['mode'] == 'WALK':
                    walk += s / 60
                    if s / 60 > lim['maxContinuousWalkMinutes'] + 1e-9: v.append('continuous walk')
            if k == len(items) - 1 and rd['endPoint'] is not None:
                leg = day['outgoingToEnd']
                if not leg or leg['mode'] not in req['travel']['modes']: v.append('FORBIDDEN_OR_MISSING_MODE')
                else:
                    s = req['travel']['seconds'][leg['mode']][c['endPoint']][rd['endPoint']]
                    if it['end'] + math.ceil(s / 60 - 1e-9) > rd['window']['end']: v.append('end anchor')
                    if leg['mode'] == 'WALK': walk += s / 60
            prev = {'endPoint': c['endPoint'], 'end': it['end']}
        if walk > lim['dailyWalkBudgetMinutes'] + 1e-9: v.append('daily walk')
    for c in req['candidates']:
        if c['mustInclude'] and c['id'] not in seen: v.append('must missing')
    return v


def score(P, req, res, u):
    idx = {c['id']: i for i, c in enumerate(P.cands)}
    W = P.M['walk']['time_s']
    m = {'status': res['status'], 'scheduled': 0, 'sumU': 0.0, 'walkMin': 0.0, 'driveMin': 0.0, 'driveLegs': 0, 'walkLegs': 0,
         'shortHopDrive': 0, 'unknownVisits': 0, 'selected': [], 'perDayTravel': []}
    if res['status'] != 'PLANNED':
        return m
    for d, day in enumerate(res['days']):
        travel = 0.0; prev = None
        legs = []
        for k, it in enumerate(day['items']):
            i = idx[it['experienceId']]; m['scheduled'] += 1; m['sumU'] += u[i]; m['unknownVisits'] += P.unc[i]; m['selected'].append(it['experienceId'])
            c = P.cands[i]
            a = (P.cands[idx[prev]] if prev else None)
            src = P.point(a, True) if a is not None else (req['days'][d]['startPoint'] if req['days'][d]['startPoint'] is not None else None)
            if it['incoming'] and src is not None: legs.append((it['incoming'], src, P.point(c, False)))
            prev = it['experienceId']
        if day['items'] and day.get('outgoingToEnd') and req['days'][d]['endPoint'] is not None:
            legs.append((day['outgoingToEnd'], P.point(P.cands[idx[prev]], True), req['days'][d]['endPoint']))
        for leg, a, b in legs:
            mins = leg['seconds'] / 60; travel += mins
            if leg['mode'] == 'WALK': m['walkMin'] += mins; m['walkLegs'] += 1
            else:
                m['driveMin'] += mins; m['driveLegs'] += 1
                w = W[a][b]
                if w is not None and w / 60 <= SHORT_WALK_MIN: m['shortHopDrive'] += 1
        m['perDayTravel'].append(round(travel, 1))
    sel = set(m['selected'])
    med = sorted(u[idx[x]] for x in sel)[len(sel) // 2] if sel else 1
    m['attractiveOmitted'] = sorted(c['id'] for i, c in enumerate(P.cands) if c['id'] not in sel and u[i] >= med)
    p75 = sorted(u)[int(0.75 * (len(u) - 1))]
    m['attractiveUnknownOmitted'] = sorted(c['id'] for i, c in enumerate(P.cands) if c['id'] not in sel and P.unc[i] and u[i] >= p75)
    for k in ('sumU', 'walkMin', 'driveMin'):
        m[k] = round(m[k], 3)
    m['travelMin'] = round(m['walkMin'] + m['driveMin'], 1)
    return m


def run_one(args):
    city, scen, kw, prof, prm, reps = args
    P = C.Problem(city, name=scen, **kw)
    req, u = build(P, prm, PROFILES[prof])
    # TEST-ONLY stop override (solver-interaction check); production stays routing-gls-sl1000-v1
    ovr = None if not prm.get('solutionLimit') else dict(first='PATH_CHEAPEST_ARC', meta='GUIDED_LOCAL_SEARCH',
                                                          solution_limit=prm['solutionLimit'], time_cap_ms=120000)
    outs = [A_.solve(req, ovr) for _ in range(reps)]
    r = outs[0]
    row = {'city': city, 'scenario': scen, 'profile': prof, 'params': prm, **score(P, req, r, u),
           'violations': validate(req, r) if r['status'] == 'PLANNED' else [],
           'identicalRepeats': len({json.dumps(o.get('days') or o.get('conflicts'), sort_keys=True) for o in outs}) == 1,
           'solveMs': [o['timings'].get('solveMs') for o in outs], 'stopReason': r['optimizer'].get('stopReason'),
           'objective': r.get('objectiveValue'), 'conflicts': r.get('conflicts'), 'poolUnknown': sum(1 for x in P.unc if x),
           'poolN': P.n}
    return row


def tasks(params_list, profiles=('A', 'B'), cities=('BA', 'PA', 'LA'), scen=SCEN, reps=1):
    out = []
    for prm in params_list:
        for city in cities:
            for name, kw in problems(city, scen):
                for prof in profiles:
                    kw2 = dict(kw); kw2['modes'] = PROFILES[prof]
                    out.append((city, name, kw2, prof, prm, reps))
    return out


def run(params_list, out_name, profiles=('A', 'B'), cities=('BA', 'PA', 'LA'), scen=SCEN, reps=1, workers=8):
    from multiprocessing import Pool
    t = tasks(params_list, profiles, cities, scen, reps)
    t0 = time.time()
    with Pool(workers) as pool:
        rows = pool.map(run_one, t, chunksize=1)
    path = os.path.join(PD7, 'runs', out_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({'meta': {'policy': POLICY, 'scale': SCALE, 'workers': workers, 'wall_s': round(time.time() - t0, 1),
                        'params': params_list, 'profiles': profiles, 'scenarios': scen}, 'rows': rows}, open(path, 'w'), indent=1)
    return rows
