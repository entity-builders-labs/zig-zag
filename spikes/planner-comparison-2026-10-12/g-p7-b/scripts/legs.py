"""G-P7-B — factual comparison of the recorded BICYCLE matrices with the recorded WALK / DRIVE ones.

Solver-free. For every ordered candidate pair (same 31 points per city, identical order in the three
recorded matrices): distributions, evidence that BICYCLE is not a WALK/DRIVE derivative (ratio spread,
pairs where cycling is slower than walking or faster than driving), representative legs (very short,
medium, long, bicycle faster than drive, walking sensible) and the per-leg mode the G-P7-U.B check
point would choose under each allowed-mode profile. Writes ../runs/legs.json.
"""
import json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE); SPIKE = os.path.dirname(GATE)
POINT = {'cd': 1.0, 'Ad': 11.0, 'cb': 0.6, 'Ab': 6.0}   # G-P7-U.B check point (PROPOSED, owner-dependent)
LIMIT_WALK = 30                                        # P11 continuous-walking limit (hard)
PROFILES = {'WALK+BICYCLE': ('walk', 'bicycle'), 'WALK+DRIVE+BICYCLE': ('walk', 'drive', 'bicycle'),
            'WALK+DRIVE': ('walk', 'drive'), 'BICYCLE': ('bicycle',)}


def cost(mode, mins, p):
    return {'walk': mins, 'drive': p['cd'] * mins + p['Ad'], 'bicycle': p['cb'] * mins + p['Ab']}[mode]


def choose(modes, t, p):
    opts = [(cost(m, t[m], p), m) for m in modes if t[m] is not None and not (m == 'walk' and t[m] > LIMIT_WALK)]
    return min(opts)[1] if opts else None


def q(xs, f):
    xs = sorted(xs); return round(xs[int(f * (len(xs) - 1))], 1)


def main():
    out = {'point': POINT, 'cities': {}}
    for city in ('BA', 'PA', 'LA'):
        M = {m: json.load(open(os.path.join(SPIKE, 'fixtures', f'{city}_matrix_{m}.json'))) for m in ('walk', 'drive')}
        M['bicycle'] = json.load(open(os.path.join(GATE, 'fixtures', f'{city}_matrix_bicycle.json')))
        pts = [p['pid'] for p in M['walk']['points']]
        assert all([p['pid'] for p in M[m]['points']] == pts for m in M)
        n = len(pts); legs = []
        for i in range(n):
            for j in range(n):
                if i == j: continue
                t = {m: (None if M[m]['time_s'][i][j] is None else M[m]['time_s'][i][j] / 60) for m in M}
                dist = {m: M[m]['distance_m'][i][j] for m in M}
                legs.append({'from': pts[i], 'to': pts[j], 't': t, 'd': dist})
        full = [l for l in legs if all(l['t'][m] for m in l['t'])]
        bw = [l['t']['bicycle'] / l['t']['walk'] for l in full]
        bd = [l['t']['bicycle'] / l['t']['drive'] for l in full]
        c = {'pairs': len(legs), 'unavailable': {m: sum(1 for l in legs if l['t'][m] is None) for m in M},
             'zeroTimePairs': sum(1 for l in legs if any(v == 0 for v in l['t'].values() if v is not None)),
             'minutes': {m: {'p10': q([l['t'][m] for l in full], .1), 'median': q([l['t'][m] for l in full], .5),
                             'p90': q([l['t'][m] for l in full], .9)} for m in M},
             'bicycleOverWalk': {'p10': round(q(bw, .1), 3), 'median': round(st.median(bw), 3), 'p90': round(q(bw, .9), 3)},
             'bicycleOverDrive': {'p10': round(q(bd, .1), 2), 'median': round(st.median(bd), 2), 'p90': round(q(bd, .9), 2)},
             'bicycleSlowerThanWalk': sum(1 for l in full if l['t']['bicycle'] > l['t']['walk']),
             'bicycleFasterThanDrive': sum(1 for l in full if l['t']['bicycle'] < l['t']['drive']),
             'bicycleDistanceDiffersFromWalk': sum(1 for l in full if abs(l['d']['bicycle'] - l['d']['walk']) > 50)}
        # representative legs
        def pick(pred, key):
            xs = [l for l in full if pred(l)]
            return min(xs, key=key) if xs else None
        reps = {
            'veryShort': pick(lambda l: l['t']['walk'] <= 8, lambda l: abs(l['t']['walk'] - 6)),
            'shortUrban': pick(lambda l: 9 <= l['t']['walk'] <= 15, lambda l: abs(l['t']['walk'] - 12)),
            'mediumUrban': pick(lambda l: 20 <= l['t']['walk'] <= 40, lambda l: abs(l['t']['walk'] - 30)),
            'longCrossCity': pick(lambda l: l['t']['walk'] >= 90, lambda l: -l['t']['walk']),
            'bicycleFasterThanDrive': pick(lambda l: l['t']['bicycle'] < l['t']['drive'], lambda l: l['t']['bicycle'] - l['t']['drive']),
            'walkStillSensible': pick(lambda l: l['t']['walk'] <= 6 and l['t']['bicycle'] >= 2, lambda l: l['t']['walk']),
        }
        c['representative'] = {}
        for k, l in reps.items():
            if not l: c['representative'][k] = None; continue
            c['representative'][k] = {'from': l['from'], 'to': l['to'], 'minutes': {m: round(v, 1) for m, v in l['t'].items()},
                                      'meters': l['d'], 'choice': {pn: choose(ms, l['t'], POINT) for pn, ms in PROFILES.items()}}
        # mode shares per profile over all pairs (walk only when within the continuous limit)
        c['modeChoiceShares'] = {}
        for pn, ms in PROFILES.items():
            ch = [choose(ms, l['t'], POINT) for l in legs]
            c['modeChoiceShares'][pn] = {m: round(sum(1 for x in ch if x == m) / len(ch), 3) for m in set(ch)}
        # walk-band behaviour WALK+BICYCLE: share choosing bicycle per walking band
        bands = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 30)]
        c['walkBandBicycleShare'] = {f'{a}-{b}': (lambda xs: round(sum(1 for x in xs if x == 'bicycle') / len(xs), 2) if xs else None)(
            [choose(('walk', 'bicycle'), l['t'], POINT) for l in full if a < l['t']['walk'] <= b]) for a, b in bands}
        out['cities'][city] = c
        print(city, json.dumps({k: c[k] for k in ('unavailable', 'bicycleOverWalk', 'bicycleOverDrive', 'bicycleSlowerThanWalk',
                                                   'bicycleFasterThanDrive', 'walkBandBicycleShare')}))
    json.dump(out, open(os.path.join(GATE, 'runs', 'legs.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
