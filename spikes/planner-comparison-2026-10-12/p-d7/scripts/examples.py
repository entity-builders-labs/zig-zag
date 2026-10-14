"""Desirability-vs-travel examples and representative Tours (README §8, §Representative Tours).
- isolation: top-quartile candidates ranked by median drive time to the other candidates; selected under K30 / K120 / K960?
- refusal: scenarios where low K schedules (almost) nothing although high K schedules worthwhile visits;
- excess: travel added from K120 to K960 for the same or lower Σu.
Writes ../runs/examples.json and ../runs/representative_tours.json"""
import json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calib, common as C   # noqa: E402

R = os.path.join(calib.PD7, 'runs')
k2 = [r for r in json.load(open(os.path.join(R, 'stage2_K.json')))['rows'] if r['status'] == 'PLANNED']
get = lambda name, city, scen, prof: next(r for r in k2 if r['params']['name'] == name and r['city'] == city and r['scenario'] == scen and r['profile'] == prof)
ex = {'isolation': [], 'refusal': [], 'excess': []}
for city in ('BA', 'PA', 'LA'):
    P = C.Problem(city, 30, 3); D = P.M['drive']['time_s']; dmax = max(c['desirability'] for c in P.cands)
    iso = []
    for i, c in enumerate(P.cands):
        u = c['desirability'] / dmax
        others = [D[P.point(c, True)][P.point(o, False)] / 60 for j, o in enumerate(P.cands) if j != i and D[P.point(c, True)][P.point(o, False)] is not None]
        iso.append((st.median(others), u, c['id'], c['title']))
    q75 = sorted(x[1] for x in iso)[int(0.75 * (len(iso) - 1))]
    for med, u, cid, title in sorted([x for x in iso if x[1] >= q75], reverse=True)[:2]:
        ex['isolation'].append({'city': city, 'id': cid, 'title': title, 'u': round(u, 3), 'medianDriveToOthersMin': round(med, 1),
                                **{f'selected_{n}_{p}': cid in get(n, city, 'S1-normal-pall', p)['selected'] for n in ('K30', 'K120', 'K960') for p in ('A', 'B')}})
    for scen in calib.SCEN:
        for p in ('A', 'B'):
            try:
                lo, mid, hi = get('K30', city, scen, p), get('K120', city, scen, p), get('K960', city, scen, p)
            except StopIteration:
                continue
            if mid['sumU'] and lo['sumU'] < 0.8 * mid['sumU']:
                ex['refusal'].append({'case': f'{city} {scen} {p}', 'K30': (lo['scheduled'], lo['sumU'], lo['travelMin']),
                                      'K120': (mid['scheduled'], mid['sumU'], mid['travelMin'])})
            if hi['travelMin'] > mid['travelMin'] + 10 and hi['sumU'] <= mid['sumU'] + 1e-6:
                ex['excess'].append({'case': f'{city} {scen} {p}', 'K120': (mid['scheduled'], mid['sumU'], mid['travelMin'], mid['driveLegs']),
                                     'K960': (hi['scheduled'], hi['sumU'], hi['travelMin'], hi['driveLegs'])})
json.dump(ex, open(os.path.join(R, 'examples.json'), 'w'), indent=1)
for k, v in ex.items():
    print(k)
    for x in v:
        print('  ', x)
# representative final Tours (stage 6, normal 3-day, profile A and B per city)
s6 = json.load(open(os.path.join(R, 'stage6_final.json')))['rows']
rep = [{k: r[k] for k in ('city', 'scenario', 'profile', 'scheduled', 'sumU', 'walkMin', 'driveMin', 'driveLegs', 'unknownVisits', 'perDayTravel', 'selected', 'attractiveOmitted')}
       for r in s6 if r['scenario'] in ('S1-normal-pall', 'S9-anchors-startend-p20') and r['status'] == 'PLANNED']
json.dump(rep, open(os.path.join(R, 'representative_tours.json'), 'w'), indent=1)
