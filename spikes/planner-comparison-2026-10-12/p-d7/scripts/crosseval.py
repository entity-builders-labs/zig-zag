"""Cross-evaluation: score plan X (found under policy p) with the objective of policy q. If the zero-penalty plan scores
higher under policy q than q's own solver plan, q's deviation is a search (SL1000) artifact, not an objective effect.
Usage: python -I crosseval.py runs/<file>.json <ref-name> <name>..."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calib, common as C   # noqa: E402

key = lambda r: (r['city'], r['scenario'], r['profile'])
probs = {}


def objective(r, prm):
    """TourUtility in tme for a scored run under parameters prm (uses per-request normalized u)."""
    k = key(r)
    if k not in probs:
        city, scen, prof = k
        kw = dict(next(kw for n, kw in calib.problems(city) if n == scen)); kw['modes'] = calib.PROFILES[prof]
        P = C.Problem(city, name=scen, **kw); dmax = max(c['desirability'] for c in P.cands)
        probs[k] = {c['id']: (c['desirability'] / dmax, P.unc[i], len(P.visit_components(c))) for i, c in enumerate(P.cands)}
    tab = probs[k]
    val = sum(prm['K'] * tab[x][0] * (1 - prm.get('rho', 0) * tab[x][1] / tab[x][2]) - prm.get('P', 0) * tab[x][1] for x in r['selected'])
    return val - r['walkMin'] - prm['cd'] * r['driveMin'] - prm['A'] * r['driveLegs']


def main():
  d = json.load(open(sys.argv[1])); ref = sys.argv[2]; names = sys.argv[3:]
  rows = {(r['params']['name'],) + key(r): r for r in d['rows'] if r['status'] == 'PLANNED'}
  out = []
  for name in names:
    prm = next(p for p in d['meta']['params'] if p['name'] == name)
    search, objective_driven, same = [], 0, 0
    for k, r in [(k[1:], v) for k, v in rows.items() if k[0] == name]:
        b = rows.get((ref,) + k)
        if not b:
            continue
        own, other = objective(r, prm), objective(b, prm)
        if set(r['selected']) == set(b['selected']):
            same += 1
        elif other > own + 1e-6:
            search.append((' '.join(k), round(other - own, 1)))
        else:
            objective_driven += 1
    out.append({'policy': name, 'sameSelection': same, 'objectiveDriven': objective_driven, 'searchArtifacts': search})
    print(f"{name}: same selection {same}, objective-driven changes {objective_driven}, search artifacts {len(search)} {search[:4]}")
  json.dump(out, open(sys.argv[1].replace('.json', '_crosseval.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
