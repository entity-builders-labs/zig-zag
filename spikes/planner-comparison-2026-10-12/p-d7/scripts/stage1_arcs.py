"""Stage 1 (solver-free): per-arc WALK vs DRIVE choice under candidate (c_d, A), on every candidate pair of the
three fixtures where walking is within the 30-min continuous limit and a drive estimate exists.
Writes ../runs/stage1_arcs.json. Also writes the raw scale distributions (../runs/distributions.json)."""
import json, os, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); PD7 = os.path.dirname(HERE); FX = os.path.join(os.path.dirname(PD7), 'fixtures')
LIMIT = 30
BANDS = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 25), (25, 30)]


def q(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))] if xs else None


def pairs(city):
    W = json.load(open(os.path.join(FX, f'{city}_matrix_walk.json'))); D = json.load(open(os.path.join(FX, f'{city}_matrix_drive.json')))
    pts = W['points']; out = []
    for i in range(len(pts)):
        for j in range(len(pts)):
            if i == j or 'HOTEL' in (pts[i]['pid'], pts[j]['pid']) or pts[i]['pid'].split('#')[0] == pts[j]['pid'].split('#')[0]:
                continue
            w, d = W['time_s'][i][j], D['time_s'][i][j]
            out.append((None if w is None else w / 60, None if d is None else d / 60))
    return out


def main():
    dist = {}
    for city in ('BA', 'PA', 'LA'):
        fx = json.load(open(os.path.join(FX, f'{city}.json'))); d = [c['desirability'] for c in fx['candidates']]
        ps = pairs(city); w = [a for a, _ in ps if a is not None]; dr = [b for _, b in ps if b is not None]
        dist[city] = {'desirability': {'n': len(d), 'min': min(d), 'p25': q(d, .25), 'median': q(d, .5), 'p75': q(d, .75), 'max': max(d),
                                       'source': fx['candidates'][1]['desirability_source']},
                      'walkMin': {k: round(q(w, p), 1) for k, p in (('p10', .1), ('median', .5), ('p90', .9))} | {'max': round(max(w), 1), 'shareLe10': round(sum(x <= 10 for x in w) / len(w), 3), 'shareLe30': round(sum(x <= 30 for x in w) / len(w), 3)},
                      'driveMin': {k: round(q(dr, p), 1) for k, p in (('p10', .1), ('median', .5), ('p90', .9))} | {'max': round(max(dr), 1)},
                      'walkToDriveRatioMedian': round(q([a / b for a, b in ps if a and b], .5), 2),
                      'unknownHoursCandidates': sum(1 for c in fx['candidates'] if any(k['participation'] == 'VISIT' and k['hours']['status'] != 'KNOWN' for k in c['components']))}
    json.dump(dist, open(os.path.join(PD7, 'runs', 'distributions.json'), 'w'), indent=1)
    configs = [('S-A', 1, A) for A in (0, 2, 5, 10, 15, 20)] + [('S-C', cd, 0) for cd in (2, 3, 4, 6)] + [('P11', 2, 10)]
    rows = []
    for city in ('BA', 'PA', 'LA'):
        ps = [(w, d) for w, d in pairs(city) if w is not None and d is not None and w <= LIMIT]
        for name, cd, A in configs:
            band = {}
            for lo, hi in BANDS:
                sel = [(w, d) for w, d in ps if lo < w <= hi]
                drv = sum(1 for w, d in sel if cd * d + A < w)
                band[f'{lo}-{hi}'] = {'arcs': len(sel), 'driveShare': round(drv / len(sel), 2) if sel else None}
            short = [(w, d) for w, d in ps if w <= 10]
            rows.append({'city': city, 'structure': name, 'cd': cd, 'A': A, 'walkableArcs': len(ps),
                         'shortHopRate': round(sum(1 for w, d in short if cd * d + A < w) / len(short), 2) if short else None,
                         'driveShareAll': round(sum(1 for w, d in ps if cd * d + A < w) / len(ps), 2), 'bands': band})
    json.dump(rows, open(os.path.join(PD7, 'runs', 'stage1_arcs.json'), 'w'), indent=1)
    for r in rows:
        print(r['city'], r['structure'], f"cd={r['cd']} A={r['A']}", 'shortHop', r['shortHopRate'], 'driveAll', r['driveShareAll'],
              ' '.join(f"{k}:{v['driveShare']}" for k, v in r['bands'].items()))


if __name__ == '__main__':
    main()
