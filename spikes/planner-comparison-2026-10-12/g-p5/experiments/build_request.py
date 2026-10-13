"""Build a planning-problem-v1 request from a P11 Problem (same fixtures, same test-only objective).
Used by the stop-policy experiments and to cross-check the Node request builder (identical JSON)."""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SPIKE, 'scripts')); sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'sidecar'))
import common as C   # noqa: E402  (P11 problem model)

OBJECTIVE_POLICY = 'p11-test-weights-2026-10-12'   # TEST-ONLY; not P-D7


def request_from_problem(P, policy='routing-gls-sl1000-v1', request_id=None):
    W = P.weights
    pts = P.M['walk']['points']
    h = P.pidx['HOTEL']
    return {
        'contractVersion': 'planning-problem-v1',
        'requestId': request_id or f'{P.city}:{P.name}',
        'days': [{'date': d, 'window': {'start': P.window[0], 'end': P.window[1]},
                  'startPoint': h if P.start_anchor else None, 'endPoint': h if P.end_anchor else None} for d in P.dates],
        'travel': {'points': [p['pid'] for p in pts], 'modes': [m.upper() for m in P.modes],
                   'seconds': {m.upper(): P.M[m]['time_s'] for m in P.modes}},
        'candidates': [{'id': c['id'], 'startPoint': P.point(c, False), 'endPoint': P.point(c, True),
                        'serviceMinutes': math.ceil(P.service[i] - 1e-9), 'utility': P.value[i],
                        'uncertainVisitComponents': P.unc[i], 'mustInclude': c['id'] in P.must,
                        'startWindowsByDay': [[list(w) for w in P.ivs[i][d]] for d in range(len(P.dates))]}
                       for i, c in enumerate(P.cands)],
        'limits': {'maxContinuousWalkMinutes': P.limits['max_continuous_walk_min'],
                   'dailyWalkBudgetMinutes': P.limits['daily_walk_budget_min']},
        'objective': {'policyVersion': OBJECTIVE_POLICY,
                      'openingHoursUncertaintyPenalty': W['opening_hours_uncertainty_penalty'],
                      'travelCost': {'WALK': {'perMinute': W['walk_cost_per_min'], 'perLeg': 0},
                                     'DRIVE': {'perMinute': W['drive_cost_per_min'], 'perLeg': W['drive_leg_cost']}}},
        'optimizerPolicyVersion': policy,
    }


def plan_from_result(P, res):
    """planning-result-v1 -> P11 plan shape, so P11 check()/metrics() score it identically to the recorded runs."""
    idx = {c['id']: i for i, c in enumerate(P.cands)}
    if res['status'] != 'PLANNED':
        return {'days': [[] for _ in P.dates]}
    return {'days': [[{'i': idx[it['experienceId']], 'start': it['start']} for it in d['items']] for d in res['days']]}
