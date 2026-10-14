"""For each newly dropped attractive UNKNOWN candidate in the best-known plan of a policy (vs the zero-penalty best-known
plan), list what replaced it: u of the dropped item vs u of the added items and whether those have KNOWN hours.
Usage: python -I swaps.py runs/stage4_unknown.json rho0 <policy>..."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crosseval as X   # noqa: E402

d = json.load(open(sys.argv[1])); ref = sys.argv[2]; names = sys.argv[3:]
plans = {}
for r in d['rows']:
    if r['status'] == 'PLANNED':
        plans.setdefault(X.key(r), []).append(r)
pr = {p['name']: p for p in d['meta']['params']}


def best(name, k):
    return max(plans[k], key=lambda r: (round(X.objective(r, pr[name]), 6), -len(r['selected'])))


out = []
for name in names:
    gaps = []
    for k in plans:
        b0, b = best(ref, k), best(name, k)
        tab = X.probs[k]
        dropped = [x for x in set(b['attractiveUnknownOmitted']) - set(b0['attractiveUnknownOmitted'])]
        if not dropped:
            continue
        added = sorted(set(b['selected']) - set(b0['selected']), key=lambda x: -tab[x][0])
        for x in dropped:
            row = {'policy': name, 'case': ' '.join(k), 'dropped': x, 'uDropped': round(tab[x][0], 3),
                   'added': [{'id': y, 'u': round(tab[y][0], 3), 'unknown': bool(tab[y][1])} for y in added],
                   'deltaSumU': round(b['sumU'] - b0['sumU'], 3)}
            out.append(row)
            best_add = max((a['u'] for a in row['added'] if not a['unknown']), default=None)
            gaps.append(None if best_add is None else row['uDropped'] - best_add)
            print(f"{name} | {row['case']} | dropped u={row['uDropped']} | added {[(a['u'], 'UNK' if a['unknown'] else 'KNOWN') for a in row['added']]} | ΔΣu {row['deltaSumU']}")
    print(f"  {name}: max u gap dropped-vs-best-added-KNOWN = {max((g for g in gaps if g is not None), default=None)}; drops with no KNOWN replacement = {sum(g is None for g in gaps)}")
json.dump(out, open(sys.argv[1].replace('.json', '_swaps.json'), 'w'), indent=1)
