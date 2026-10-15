"""G-P7-U.B — pairwise Tour judgments -> inequalities -> feasible parameter regions (no fitting).

Every judgment compares Tour A and Tour B for the SAME request where one controlled tradeoff differs,
states the expected product behaviour BEFORE any parameter is examined, and records where that
expectation comes from:

  DERIVED   follows from an accepted rule (G-P7-U.A precedence/monotonicity, P-D4, hard modes);
  PROPOSED  a human-quality rationale written here; it is NOT ground truth and needs owner confirmation.

Objective family under test (unit: tme = travel-minute equivalent; 1 walking minute = 1 tme):

  TourUtility = Σ_scheduled p_i · (1 − ρ·f_i)  −  Σ_legs (c_m · minutes + A_m)
  p_i = K · v_i / v_max(request)          v_i = D_i + β·I_i + γ·r_i
    D_i  Σ stated importance of matched DIRECT facets  (strong 1.0 / medium 0.7 / weak 0.5, live mapping)
    I_i  Σ importance × confidence of matched INFERRED facets
    r_i  ∈ [0, 1] within-request refinement position (soft anchor → semantic → quality, G-P7-U.A order)
    f_i  uncertain / total VISIT components (P-D4)
  c_WALK ≡ 1 (unit), c_DRIVE, c_BICYCLE per minute; A_DRIVE, A_BICYCLE per-leg mode friction; A_WALK = 0.

In the abstract judgments the request's best candidate is a strong DIRECT match, so v_max = 1 and a
strong DIRECT Experience is worth K tme. Each judgment is a linear (or bilinear) inequality; the script
enumerates log-spaced grids, keeps the points satisfying every judgment of a set, and reports interval
projections and a Chebyshev-style centre (largest minimum log-margin). Nothing is fitted to fixtures.
"""
import itertools, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE)
STRONG, MEDIUM, WEAK = 1.0, 0.7, 0.5       # live mapStrengthToImportance (preference-facet.interface.ts)

J = []


def judgment(jid, group, a, b, status, source, lhs, rhs):
    """Expected behaviour: Tour A strictly preferred, i.e. lhs(params) > rhs(params), both sides ≥ 0
    (lhs = what A gains over B, rhs = what A costs over B). Slack is reported as log(lhs / rhs)."""
    J.append({'id': jid, 'group': group, 'tourA': a, 'tourB': b, 'status': status, 'source': source,
              'lhs': lhs, 'rhs': rhs, 'f': lambda p: lhs(p) - rhs(p)})


def walk(m):  # cost of a walking leg
    return m


def drive(m, p):
    return p['cd'] * m + p['Ad']


def bike(m, p):
    return p['cb'] * m + p['Ab']


# ---------------------------------------------------------------- group P: preference value (K, β, γ)
judgment('P-D1', 'P', 'swap in a weak DIRECT match (same travel)', 'keep the best semantic-only candidate',
         'DERIVED', 'G-P7-U.A: explicit evidence outranks anchor/semantic/quality; equal-cost swap follows the candidate order',
         lambda p: p['K'] * WEAK, lambda p: p['K'] * p['g'])
judgment('P-D2', 'P', 'swap in a weak DIRECT match (same travel)', 'keep a strong INFERRED match at confidence 1.0 with the best refinement',
         'DERIVED', 'G-P7-U.A: DIRECT outranks any INFERRED total (single INFERRED facet case)',
         lambda p: p['K'] * WEAK, lambda p: p['K'] * (p['b'] * STRONG * 1.0 + p['g']))
judgment('P-D3', 'P', 'swap in a strong INFERRED match at confidence 0.8 (same travel)', 'keep the best semantic-only candidate',
         'DERIVED', 'G-P7-U.A: INFERRED evidence outranks anchor/semantic/quality (typical confidence; '
                    'arbitrarily low confidence is covered by the order-preserving repair, not by γ)',
         lambda p: p['K'] * p['b'] * 0.8, lambda p: p['K'] * p['g'])
judgment('P-D4', 'P', 'the same Experiences in an order with 5 min of walking', 'an order with 10 min of walking',
         'DERIVED', 'preference-first: at equal preference satisfaction less travel is better',
         lambda p: walk(10), lambda p: walk(5))
# Tour-level accumulation (the question G-P7-U.A left to B)
judgment('P-O1a', 'P', 'add one strong DIRECT Experience at +40 min travel', 'do not add it',
         'PROPOSED', 'the user named this preference as strong; 40 min fits a 600 min day',
         lambda p: p['K'] * STRONG, lambda p: walk(40))
judgment('P-O1b', 'P', 'add one strong DIRECT Experience at +60 min travel', 'do not add it',
         'PROPOSED', 'as P-O1a; one hour of travel for a strongly stated preference is still worth it',
         lambda p: p['K'] * STRONG, lambda p: walk(60))
judgment('P-O1c', 'P', 'do not add', 'add one strong DIRECT Experience at +150 min travel',
         'PROPOSED', '2.5 h of travel for one Experience degrades the Tour (a quarter of the day in transit)',
         lambda p: walk(150), lambda p: p['K'] * STRONG)
judgment('P-O2a', 'P', 'add one weak DIRECT Experience at +20 min', 'do not add it',
         'PROPOSED', 'a stated (weak) preference is worth a short detour',
         lambda p: p['K'] * WEAK, lambda p: walk(20))
judgment('P-O2b', 'P', 'do not add', 'add one weak DIRECT Experience at +75 min',
         'PROPOSED', 'a weakly stated preference is not worth more than an hour of travel',
         lambda p: walk(75), lambda p: p['K'] * WEAK)
judgment('P-O3a', 'P', 'add one strong INFERRED Experience (confidence 0.8) at +10 min', 'do not add it',
         'PROPOSED', 'an inferred match is still a preference match; a short detour is acceptable',
         lambda p: p['K'] * p['b'] * 0.8, lambda p: walk(10))
judgment('P-O3b', 'P', 'do not add', 'add one strong INFERRED Experience (confidence 0.8) at +45 min',
         'PROPOSED', 'the user never stated it; a long detour is not justified',
         lambda p: walk(45), lambda p: p['K'] * p['b'] * 0.8)
judgment('P-O4a', 'P', 'add the best semantic-only Experience at +3 min', 'do not add it',
         'PROPOSED', 'a relevant Experience on the way is worth adding when time allows',
         lambda p: p['K'] * p['g'], lambda p: walk(3))
judgment('P-O4b', 'P', 'do not add', 'add the best semantic-only Experience at +20 min',
         'PROPOSED', 'no stated or inferred preference; not worth a real detour',
         lambda p: walk(20), lambda p: p['K'] * p['g'])
judgment('P-O5', 'P', 'two medium DIRECT Experiences', 'one strong DIRECT Experience (same total travel)',
         'PROPOSED', 'each satisfied stated preference counts; 0.7 + 0.7 > 1.0 in the live importance mapping',
         lambda p: p['K'] * 2 * MEDIUM, lambda p: p['K'] * STRONG)
judgment('P-O6', 'P', 'one weak DIRECT Experience', 'two strong INFERRED Experiences at confidence 0.8 (same travel)',
         'PROPOSED', 'what the user said outranks what was inferred, even twice over',
         lambda p: p['K'] * WEAK, lambda p: p['K'] * 2 * p['b'] * STRONG * 0.8)
judgment('P-O7', 'P', 'swap to a better-refined Experience (Δr = 0.5, same explicit evidence) at +5 min', 'keep the original',
         'PROPOSED', 'semantic refinement may justify a small detour',
         lambda p: p['K'] * p['g'] * 0.5, lambda p: walk(5))

# ---------------------------------------------------------------- group U: UNKNOWN opening hours (ρ, with K)
judgment('U-D1', 'U', 'KNOWN-hours Experience', 'otherwise identical UNKNOWN-hours Experience',
         'DERIVED', 'P-D4 PENALIZE: known-compatible hours preferred over otherwise-equivalent UNKNOWN',
         lambda p: p['K'] * p['rho'], lambda p: 0.0)
judgment('U-D2', 'U', 'schedule a lone UNKNOWN-hours weak DIRECT Experience (no extra travel)', 'leave the slot empty',
         'DERIVED', 'P-D4: UNKNOWN stays feasible; the cost must not erase an Experience by itself (owner brief)',
         lambda p: p['K'] * WEAK * (1 - p['rho']), lambda p: 0.0)
judgment('U-O1', 'U', 'UNKNOWN-hours strong DIRECT Experience', 'KNOWN-hours weak DIRECT Experience (same travel)',
         'PROPOSED', 'preference-first: uncertainty is a near-tie cost and does not overturn a clearly stronger stated preference',
         lambda p: p['K'] * STRONG * (1 - p['rho']), lambda p: p['K'] * WEAK)
judgment('U-O2', 'U', 'KNOWN-hours alternative of equal value at +5 min', 'UNKNOWN-hours strong DIRECT Experience at +0',
         'PROPOSED', 'avoiding a possibly closed venue is worth a few minutes',
         lambda p: p['K'] * STRONG * p['rho'], lambda p: walk(5))
judgment('U-O3', 'U', 'UNKNOWN-hours strong DIRECT Experience at +0', 'KNOWN-hours alternative of equal value at +30 min',
         'PROPOSED', 'half an hour of travel is too much to pay for hours certainty alone',
         lambda p: walk(30), lambda p: p['K'] * STRONG * p['rho'])

# ---------------------------------------------------------------- group M: WALK vs DRIVE (c_d, A_d)
for jid, w, d, exp, src in [
        ('M-O1', 8, 3, 'walk', 'a short walk beats a car hop (vehicle activation)'),
        ('M-O2', 12, 4, 'walk', 'a 12-minute walk is still a pleasant urban leg'),
        ('M-O3', 20, 5, 'drive', 'a 20-minute walk against a 5-minute drive wastes the day'),
        ('M-O4', 30, 8, 'drive', 'at the continuous-walking limit the car is better')]:
    if exp == 'walk':
        judgment(jid, 'M', f'walk {w} min', f'drive {d} min', 'PROPOSED', src, lambda p, w=w, d=d: drive(d, p), lambda p, w=w: walk(w))
    else:
        judgment(jid, 'M', f'drive {d} min', f'walk {w} min', 'PROPOSED', src, lambda p, w=w: walk(w), lambda p, d=d: drive(d, p))
judgment('M-O5', 'M', 'one drive leg of 20 min', 'two drive legs of 8 min each (16 min) for the same visits',
         'PROPOSED', 'each vehicle activation has a cost; four minutes do not justify a second activation',
         lambda p: 2 * drive(8, p), lambda p: drive(20, p))
judgment('M-D1', 'M', 'drive 20 min', 'drive 30 min (same visits)', 'DERIVED', 'less travel at equal satisfaction',
         lambda p: drive(30, p), lambda p: drive(20, p))

# ---------------------------------------------------------------- group B: BICYCLE (c_b, A_b, with c_d, A_d)
for jid, w, b, exp, src in [
        ('B-O1', 6, 3, 'walk', 'a very short walk beats unlocking and parking a bicycle'),
        ('B-O2', 15, 5, 'bike', 'when the user allowed cycling, a 15-minute walk vs a 5-minute ride favours the ride'),
        ('B-O3', 25, 8, 'bike', 'as B-O2, more clearly')]:
    if exp == 'walk':
        judgment(jid, 'B', f'walk {w} min', f'bicycle {b} min', 'PROPOSED', src, lambda p, b=b: bike(b, p), lambda p, w=w: walk(w))
    else:
        judgment(jid, 'B', f'bicycle {b} min', f'walk {w} min', 'PROPOSED', src, lambda p, w=w: walk(w), lambda p, b=b: bike(b, p))
judgment('B-O4', 'B', 'bicycle 10 min', 'drive 5 min (both allowed)', 'PROPOSED',
         'the user allowed cycling; a short ride is not worse than a short car hop',
         lambda p: drive(5, p), lambda p: bike(10, p))
judgment('B-O5', 'B', 'drive 10 min', 'bicycle 35 min (both allowed)', 'PROPOSED',
         'a long ride across the city is a real burden next to a short drive',
         lambda p: bike(35, p), lambda p: drive(10, p))

GRIDS = {
    'P': {'K': [10 * 1.1 ** k for k in range(0, 45)], 'b': [0.02 * 1.12 ** k for k in range(0, 40)],
          'g': [0.005 * 1.12 ** k for k in range(0, 50)]},
    'U': {'K': [10 * 1.1 ** k for k in range(0, 45)], 'rho': [0.005 * 1.1 ** k for k in range(0, 55)]},
    'M': {'cd': [0.25 * 1.08 ** k for k in range(0, 40)], 'Ad': [0.5 * 1.08 ** k for k in range(0, 55)]},
    'B': {'cd': None, 'Ad': None, 'cb': [0.25 * 1.08 ** k for k in range(0, 40)], 'Ab': [0.25 * 1.08 ** k for k in range(0, 55)]},
}


def region(group, statuses, fixed=None):
    js = [j for j in J if j['group'] == group and j['status'] in statuses]
    grid = dict(GRIDS[group])
    for k, v in (fixed or {}).items():
        grid[k] = [v]
    keys = list(grid)
    pts = []
    for vals in itertools.product(*[grid[k] for k in keys]):
        p = dict(zip(keys, vals))
        if all(j['f'](p) > 0 for j in js):
            pts.append(p)
    if not pts:
        return {'judgments': [j['id'] for j in js], 'feasible': False}
    proj = {k: [min(q[k] for q in pts), max(q[k] for q in pts)] for k in keys}

    def margin(p):   # smallest log(lhs / rhs) over the judgments: how far every judgment is from flipping
        return min([math.log(j['lhs'](p) / j['rhs'](p)) for j in js if j['rhs'](p) > 0], default=math.inf)
    centre = max(pts, key=margin)
    edge = {k: [proj[k][0] <= min(grid[k]), proj[k][1] >= max(grid[k])] for k in keys if len(grid[k]) > 1}
    return {'judgments': [j['id'] for j in js], 'feasible': True, 'points': len(pts), 'projection': proj, 'atGridEdge': edge,
            'logWidth': {k: round(math.log(v[1] / v[0]), 3) if v[0] > 0 else None for k, v in proj.items()},
            'centre': centre, 'centreMargin': round(margin(centre), 3) if margin(centre) < math.inf else None}


def check(params):
    return {j['id']: j['f'](params) > 0 for j in J}


def all_margins(p):
    """log(lhs / rhs) per judgment at a full parameter point (inf when rhs = 0 and lhs > 0)."""
    out = {}
    for j in J:
        l, r = j['lhs'](p), j['rhs'](p)
        out[j['id']] = (math.inf if l > 0 else -math.inf) if r == 0 else (math.log(l / r) if l > 0 else -math.inf)
    return out


def main():
    out = {'objective': __doc__.split('Objective family under test')[1].split('In the abstract')[0].strip(),
           'judgments': [{k: v for k, v in j.items() if k not in ('f', 'lhs', 'rhs')} for j in J], 'regions': {}}
    both = {'DERIVED', 'PROPOSED'}
    R = out['regions']
    R['P'] = {'derivedOnly': region('P', {'DERIVED'}), 'derivedPlusProposed': region('P', both)}
    R['M'] = {'derivedOnly': region('M', {'DERIVED'}), 'derivedPlusProposed': region('M', both),
              'derivedPlusProposed_cd1': region('M', both, {'cd': 1.0})}
    # A simple point comfortably inside each region (rounded centre); the U and B groups are evaluated
    # conditionally on it because they share K (U) and the DRIVE terms (B).
    simple = {'K': 100.0, 'b': 0.2, 'g': 0.12, 'cd': 1.0, 'Ad': 11.0, 'cb': 0.6, 'Ab': 6.0, 'rho': 0.15}
    R['U'] = {'derivedOnly_Ksimple': region('U', {'DERIVED'}, {'K': simple['K']}),
              'derivedPlusProposed_Ksimple': region('U', both, {'K': simple['K']}),
              'derivedPlusProposed_Kfree': region('U', both)}
    fixed_drive = {'cd': simple['cd'], 'Ad': simple['Ad']}
    R['B'] = {'derivedPlusProposed_cd1_Adsimple': region('B', both, fixed_drive),
              'derivedPlusProposed_cd1_Adsimple_cb1': region('B', both, dict(fixed_drive, cb=1.0))}
    m = all_margins(simple)
    out['simplePoint'] = {'params': simple, 'allJudgmentsHold': all(v > 0 for v in m.values()),
                          'minMargin': round(min(m.values()), 3), 'margins': {k: round(v, 3) for k, v in m.items()}}
    # stability: every parameter ×0.75 / ×1.33 one at a time; which judgments flip
    stab = {}
    for k in simple:
        for f in (0.75, 1.33):
            q = dict(simple); q[k] = simple[k] * f
            mm = all_margins(q)
            stab[f'{k}x{f}'] = sorted(j for j, v in mm.items() if v <= 0)
    out['simplePointPerturbation'] = stab
    # owner sensitivity: drop one PROPOSED judgment at a time and report the widened projection
    sens = {}
    for j in [x for x in J if x['status'] == 'PROPOSED']:
        saved = list(J); J[:] = [x for x in saved if x is not j]
        g = j['group']
        fx = {'U': {'K': simple['K']}, 'B': fixed_drive}.get(g)
        r = region(g, both, fx)
        J[:] = saved
        sens[j['id']] = r.get('projection')
    out['dropOneSensitivity'] = sens
    # owner-adopted initial policy (2026-10-15): D1 c_DRIVE = 1, D2 c_BICYCLE = 1, A_BICYCLE = 4.5
    adopted = dict(simple, cb=1.0, Ab=4.5)
    ma = all_margins(adopted)
    out['adoptedPoint'] = {'params': adopted, 'allJudgmentsHold': all(v > 0 for v in ma.values()),
                           'minMargin': round(min(ma.values()), 3), 'margins': {k: round(v, 3) for k, v in ma.items()}}
    stab_a = {}
    for k in adopted:
        for f in (0.75, 1.33):
            q = dict(adopted); q[k] = adopted[k] * f
            stab_a[f'{k}x{f}'] = sorted(j for j, v in all_margins(q).items() if v <= 0)
    out['adoptedPointPerturbation'] = stab_a
    json.dump(out, open(os.path.join(GATE, 'runs', 'judgments.json'), 'w'), indent=1, default=float)
    for g, rs in R.items():
        for name, r in rs.items():
            if not r['feasible']:
                print(g, name, 'INFEASIBLE', r['judgments']); continue
            print(g, name, 'pts', r['points'], {k: [round(a, 3), round(b, 3)] for k, (a, b) in r['projection'].items()},
                  'edge', r['atGridEdge'], 'centre', {k: round(v, 3) for k, v in r['centre'].items()}, 'margin', r['centreMargin'])
    print('simple point', out['simplePoint']['allJudgmentsHold'], 'min margin', out['simplePoint']['minMargin'])
    print('perturbation flips', {k: v for k, v in stab.items() if v})
    a = out['adoptedPoint']
    print('adopted point', a['allJudgmentsHold'], 'min margin', a['minMargin'],
          'lowest', sorted(a['margins'].items(), key=lambda kv: kv[1])[:4])
    print('adopted perturbation flips', {k: v for k, v in out['adoptedPointPerturbation'].items() if v})


if __name__ == '__main__':
    main()
