"""OR-Tools Routing adapter behind the provider-neutral PlanningOptimizer contract (gate G-P5 spike).

Input:  planning-problem-v1 (dict, see ../README.md "Contract"). Output: planning-result-v1 (dict).
No OR-Tools type crosses this boundary; the caller never sees RoutingModel, RoutingIndexManager,
dimensions or protobuf parameters. The model is the P11 Routing formulation (scripts/planners.py
`routing`) with two deliberate changes, both recorded in the README:
  1. must-include = optional node with a dominant drop penalty (a solution always exists; a dropped
     must-include is reported, never a silent solver failure);
  2. transit callbacks are registered as matrices (no Python call per arc evaluation).
"""
import math, time
import ortools
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

OPTIMIZER = 'OR_TOOLS_ROUTING'
ADAPTER_VERSION = 'routing-adapter-g-p5-1'
DAY = 1440
BIG = 10 ** 6

# Stop policies are adapter-owned configuration resolved from optimizerPolicyVersion; the domain only
# names a version. `solution_limit` is the quality-control criterion (count-based, machine independent);
# `time_cap_ms` is an operational safety guard only.
POLICIES = {
    'routing-gls-sl1000-v1': dict(first='PATH_CHEAPEST_ARC', meta='GUIDED_LOCAL_SEARCH', solution_limit=1000, time_cap_ms=10000),
}
FS = routing_enums_pb2.FirstSolutionStrategy
LS = routing_enums_pb2.LocalSearchMetaheuristic


class ContractError(ValueError):
    """Request does not satisfy planning-problem-v1 (an integration bug, never a feasibility verdict)."""


def _ceil_min(seconds):
    return math.ceil(seconds / 60 - 1e-9)


def _arc(req, a, b):
    """Cheapest allowed mode for point a -> point b under the objective's per-mode cost and the
    continuous-walking limit (P11 dominated-mode pruning). None when no allowed mode is available."""
    best = None
    for mode in req['travel']['modes']:
        s = req['travel']['seconds'][mode][a][b]
        if s is None:
            continue
        mins = s / 60
        tc = req['objective']['travelCost'][mode]
        if mode == 'WALK':
            if mins > req['limits']['maxContinuousWalkMinutes']:
                continue
            walk = mins
        else:
            walk = 0
        cost = tc['perMinute'] * mins + (tc['perLeg'] if a != b else 0)
        cand = {'mode': mode, 'seconds': s, 'walkMinutes': walk, 'cost': cost}
        if best is None or (cand['cost'], cand['mode']) < (best['cost'], best['mode']):
            best = cand
    return best


def _validate(req):
    if req.get('contractVersion') != 'planning-problem-v1':
        raise ContractError('contractVersion must be planning-problem-v1')
    n_pts = len(req['travel']['points'])
    for m in req['travel']['modes']:
        mat = req['travel']['seconds'].get(m)
        if mat is None or len(mat) != n_pts or any(len(r) != n_pts for r in mat):
            raise ContractError(f'travel matrix for {m} is not {n_pts}x{n_pts}')
    ids = [c['id'] for c in req['candidates']]
    if len(set(ids)) != len(ids):
        raise ContractError('duplicate candidate id')
    for c in req['candidates']:
        if len(c['startWindowsByDay']) != len(req['days']):
            raise ContractError(f'{c["id"]}: startWindowsByDay length != days')


def solve(req, policy_override=None):
    t0 = time.perf_counter()
    _validate(req)
    policy_id = req['optimizerPolicyVersion']
    policy = policy_override or POLICIES.get(policy_id)   # override: experiments only, replaces the policy
    if not policy:
        raise ContractError(f'unknown optimizerPolicyVersion {policy_id}')
    days, cands = req['days'], req['candidates']
    D, n = len(days), len(cands)
    pen = req['objective']['openingHoursUncertaintyPenalty']

    # ---- nodes: one copy per (candidate, day with a feasible start window); anchor / free depots
    nodes, node_of_point = [], {}
    def depot(point):
        key = ('ANCHOR', point) if point is not None else ('FREE', None)
        if key not in node_of_point:
            node_of_point[key] = len(nodes); nodes.append((key[0], point, None))
        return node_of_point[key]
    starts = [depot(d.get('startPoint')) for d in days]
    ends = [depot(d.get('endPoint')) for d in days]
    copies = {}
    for i, c in enumerate(cands):
        for d in range(D):
            if c['startWindowsByDay'][d]:
                copies.setdefault(i, []).append(len(nodes)); nodes.append(('C', i, d))
    must = [i for i, c in enumerate(cands) if c.get('mustInclude')]
    unplaceable = [cands[i]['id'] for i in must if i not in copies]
    meta = {'optimizer': OPTIMIZER, 'optimizerVersion': ortools.__version__, 'optimizerPolicyVersion': policy_id,
            'adapterVersion': ADAPTER_VERSION}
    if unplaceable:   # proven, explicit conflict: no day offers a feasible start window
        return {'contractVersion': 'planning-result-v1', 'requestId': req.get('requestId'), 'status': 'INFEASIBLE',
                'conflicts': [{'experienceId': x, 'reason': 'MUST_INCLUDE_NO_FEASIBLE_START_WINDOW', 'proven': True} for x in unplaceable],
                'optimizer': meta, 'timings': {'adapterTotalMs': round((time.perf_counter() - t0) * 1000, 2)}}

    # ---- arc table between node points (mode chosen per arc)
    def point(k, end):
        kind, x, _ = nodes[k]
        if kind == 'C':
            return cands[x]['endPoint' if end else 'startPoint']
        return x
    N = len(nodes)
    arcs = [[None] * N for _ in range(N)]
    for a in range(N):
        for b in range(N):
            if a == b:
                continue
            ka, kb = nodes[a], nodes[b]
            if ka[0] == 'C' and kb[0] == 'C' and (ka[1] == kb[1] or ka[2] != kb[2]):
                continue
            pa, pb = point(a, True), point(b, False)
            if pa is None or pb is None:   # free depot: no first/last mile
                arcs[a][b] = {'mode': None, 'seconds': 0, 'walkMinutes': 0, 'cost': 0}
            else:
                arcs[a][b] = _arc(req, pa, pb)
    t_prep = time.perf_counter()

    # ---- model
    mgr = pywrapcp.RoutingIndexManager(N, D, starts, ends)
    R = pywrapcp.RoutingModel(mgr)
    svc = [cands[k[1]]['serviceMinutes'] if k[0] == 'C' else 0 for k in nodes]
    tmat = [[0 if a == b else (svc[a] + _ceil_min(arcs[a][b]['seconds']) if arcs[a][b] else BIG) for b in range(N)] for a in range(N)]
    cmat = [[0 if a == b else (round(arcs[a][b]['cost']) if arcs[a][b] else BIG) for b in range(N)] for a in range(N)]
    wmat = [[0 if a == b else (math.ceil(arcs[a][b]['walkMinutes'] * 10) if arcs[a][b] else BIG) for b in range(N)] for a in range(N)]
    tcb, ccb, wcb = R.RegisterTransitMatrix(tmat), R.RegisterTransitMatrix(cmat), R.RegisterTransitMatrix(wmat)
    R.SetArcCostEvaluatorOfAllVehicles(ccb)
    R.AddDimension(tcb, 24 * 60, D * DAY, False, 'Time'); T = R.GetDimensionOrDie('Time')
    R.AddDimension(wcb, 0, req['limits']['dailyWalkBudgetMinutes'] * 10, True, 'Walk')
    for v, d in enumerate(days):
        w = d['window']
        T.CumulVar(R.Start(v)).SetRange(v * DAY + w['start'], v * DAY + w['end'])
        T.CumulVar(R.End(v)).SetRange(v * DAY + w['start'], v * DAY + w['end'])
    for k, (kind, i, d) in enumerate(nodes):
        if kind != 'C':
            continue
        idx = mgr.NodeToIndex(k); R.VehicleVar(idx).SetValues([-1, d])
        ivs = cands[i]['startWindowsByDay'][d]; cv = T.CumulVar(idx)
        cv.SetRange(d * DAY + ivs[0][0], d * DAY + ivs[-1][1])
        for (a, b), (c, _) in zip(ivs, ivs[1:]):
            if c > b + 1:
                cv.RemoveInterval(d * DAY + b + 1, d * DAY + c - 1)
    must_penalty = sum(max(0, c['utility']) for c in cands) + 1   # dominates any achievable gain
    for i, idxs in copies.items():
        c = cands[i]
        p = must_penalty if c.get('mustInclude') else max(0, c['utility'] - pen * c['uncertainVisitComponents'])
        R.AddDisjunction([mgr.NodeToIndex(k) for k in idxs], p, 1)
    for a in range(N):
        for b in range(N):
            if a != b and nodes[a][0] == 'C' and nodes[b][0] == 'C' and arcs[a][b] is None:
                R.NextVar(mgr.NodeToIndex(a)).RemoveValue(mgr.NodeToIndex(b))
    sp = pywrapcp.DefaultRoutingSearchParameters()
    sp.first_solution_strategy = getattr(FS, policy['first'])
    sp.local_search_metaheuristic = getattr(LS, policy['meta'])
    if policy.get('solution_limit'):
        sp.solution_limit = policy['solution_limit']
    if policy.get('improvement'):
        sp.improvement_limit_parameters.improvement_rate_coefficient = policy['improvement'][0]
        sp.improvement_limit_parameters.improvement_rate_solutions_distance = policy['improvement'][1]
    if policy.get('time_cap_ms'):
        sp.time_limit.FromMilliseconds(int(policy['time_cap_ms']))
    t_model = time.perf_counter()
    sol = R.SolveWithParameters(sp)
    t_solve = time.perf_counter()
    status = R.status()
    status_name = {getattr(R, s): s for s in dir(pywrapcp.RoutingModel) if s.startswith('ROUTING_')}.get(status, str(status))
    timings = {'prepareMs': round((t_prep - t0) * 1000, 2), 'modelBuildMs': round((t_model - t_prep) * 1000, 2),
               'solveMs': round((t_solve - t_model) * 1000, 2)}
    solutions = R.solver().Solutions()
    # Which criterion ended the search. Only SOLUTION_LIMIT / SEARCH_EXHAUSTED plans are reproducible across
    # machines; a TIME_CAP stop is a valid plan but must be recorded as non-reproducible by the caller.
    if policy.get('time_cap_ms') and (t_solve - t_model) * 1000 >= policy['time_cap_ms'] * 0.98 and solutions < (policy.get('solution_limit') or float('inf')):
        stop_reason = 'TIME_CAP'
    elif policy.get('solution_limit') and solutions >= policy['solution_limit']:
        stop_reason = 'SOLUTION_LIMIT'
    else:
        stop_reason = 'SEARCH_EXHAUSTED'
    meta.update({'solverStatus': status_name, 'stopReason': stop_reason, 'reproducible': stop_reason != 'TIME_CAP',
                 'nodes': N, 'solutionsGenerated': solutions, 'branches': R.solver().Branches(),
                 'policy': {k: v for k, v in policy.items()}})
    if not sol:
        timings['adapterTotalMs'] = round((time.perf_counter() - t0) * 1000, 2)
        return {'contractVersion': 'planning-result-v1', 'requestId': req.get('requestId'), 'status': 'OPTIMIZER_FAILED',
                'failure': {'reason': 'NO_SOLUTION_WITHIN_BUDGET', 'detail': status_name}, 'optimizer': meta, 'timings': timings}

    # ---- extract neutral plan
    out_days, placed = [], set()
    for v in range(D):
        items, idx, prev = [], sol.Value(R.NextVar(R.Start(v))), mgr.IndexToNode(R.Start(v))
        while not R.IsEnd(idx):
            k = mgr.IndexToNode(idx); _, i, _ = nodes[k]; placed.add(i)
            start = sol.Min(T.CumulVar(idx)) - v * DAY; a = arcs[prev][k]
            items.append({'experienceId': cands[i]['id'], 'start': start, 'end': start + cands[i]['serviceMinutes'],
                          'incoming': None if a['mode'] is None else {'mode': a['mode'], 'seconds': a['seconds']}})
            prev = k; idx = sol.Value(R.NextVar(idx))
        a = arcs[prev][mgr.IndexToNode(idx)] if items else None
        out_days.append({'date': days[v]['date'], 'items': items,
                         'outgoingToEnd': None if not a or a['mode'] is None else {'mode': a['mode'], 'seconds': a['seconds']}})
    timings['extractMs'] = round((time.perf_counter() - t_solve) * 1000, 2)
    timings['adapterTotalMs'] = round((time.perf_counter() - t0) * 1000, 2)
    return {'contractVersion': 'planning-result-v1', 'requestId': req.get('requestId'), 'status': 'PLANNED',
            'days': out_days,
            'unscheduled': [c['id'] for i, c in enumerate(cands) if i not in placed],
            'mustIncludeUnplaced': [{'experienceId': cands[i]['id'], 'proven': False} for i in must if i not in placed],
            'objectiveValue': sol.ObjectiveValue(), 'optimizer': meta, 'timings': timings}
