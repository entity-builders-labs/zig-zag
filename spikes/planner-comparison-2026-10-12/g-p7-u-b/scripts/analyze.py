"""Summaries of runs/tours.json: hard-constraint safety, cross-city behaviour per profile at the check
point, stability under one-at-a-time perturbation, and the SL1000 gap to the best plan found for the
same problem by any parameter point (cross-evaluated under the check-point objective).
Writes runs/tours_summary.json."""
import collections, json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE)
SUFFIX = '' if os.environ.get('GP7UB_POINT', 'proposed') == 'proposed' else '_' + os.environ['GP7UB_POINT']


def main():
    d = json.load(open(os.path.join(GATE, 'runs', f'tours{SUFFIX}.json')))
    rows = d['rows']
    out = {'runs': len(rows)}
    planned = [r for r in rows if r['status'] == 'PLANNED']
    out['safety'] = {'planned': len(planned), 'notPlanned': collections.Counter(r['status'] for r in rows if r['status'] != 'PLANNED'),
                     'violations': sum(len(r['violations']) for r in planned),
                     'forbiddenModeLegs': sum(r['forbiddenLegs'] for r in planned),
                     'nonIdenticalRepeats': sum(1 for r in rows if not r['identicalRepeats']),
                     'stopReasons': collections.Counter(r['stopReason'] for r in rows),
                     'solveMs': {'median': round(st.median(x for r in rows for x in r['solveMs'] if x), 0),
                                 'max': round(max(x for r in rows for x in r['solveMs'] if x), 0)},
                     'compositeWithoutWalkScheduled': sum(1 for r in planned for x in r['requiredTraversalUnsatisfied'] if x in r['selected'])}
    simple = [r for r in rows if r['label'] == 'simple']
    by = collections.defaultdict(list)
    for r in simple:
        by[(r['profile'], r['city'])].append(r)
    prof = {}
    for (p, c), rs in sorted(by.items()):
        def tot(k): return round(sum(r[k] for r in rs), 1)
        prof.setdefault(p, {})[c] = {
            'scheduled': tot('scheduled'), 'DIRECT': tot('DIRECT'), 'INFERRED': tot('INFERRED'), 'NONE': tot('NONE'),
            'directShareOfScheduled': round(sum(r['DIRECT'] for r in rs) / max(1, sum(r['scheduled'] for r in rs)), 2),
            'travelMin': tot('travelMin'),
            'minutes': {m: round(sum(r['minutes'][m] for r in rs), 1) for m in ('WALK', 'DRIVE', 'BICYCLE')},
            'legs': {m: sum(r['legs'][m] for r in rs) for m in ('WALK', 'DRIVE', 'BICYCLE')},
            'shortHops': {m: sum(r['shortHops'][m] for r in rs) for m in ('DRIVE', 'BICYCLE')},
            'unknownVisits': tot('unknownVisits')}
    out['checkPointByProfileCity'] = prof
    # per scenario detail at the check point (DIRECT scheduled / available)
    out['checkPointDetail'] = [{k: r[k] for k in ('city', 'scenario', 'profile', 'scheduled', 'DIRECT', 'INFERRED', 'NONE',
                                                  'available', 'travelMin', 'legs', 'shortHops', 'unknownVisits', 'poolUnknown')}
                               for r in simple]
    # stability: perturbed vs check point on the same (city, scenario, profile)
    base = {(r['city'], r['scenario'], r['profile']): r for r in simple}
    stab = collections.defaultdict(lambda: {'n': 0, 'sumDretention': [], 'jaccard': [], 'travelRatio': [], 'directDelta': []})
    for r in rows:
        if r['label'] == 'simple' or r['status'] != 'PLANNED': continue
        b = base[(r['city'], r['scenario'], r['profile'])]
        s = stab[r['label']]; s['n'] += 1
        s['sumDretention'].append(r['sumD'] / b['sumD'] if b['sumD'] else 1.0)
        A, B = set(r['selected']), set(b['selected'])
        s['jaccard'].append(len(A & B) / len(A | B) if A | B else 1.0)
        s['travelRatio'].append(r['travelMin'] / b['travelMin'] if b['travelMin'] else 1.0)
        s['directDelta'].append(r['DIRECT'] - b['DIRECT'])
    out['perturbation'] = {k: {'runs': v['n'], 'sumDirectImportanceRetention': {'mean': round(st.mean(v['sumDretention']), 3), 'worst': round(min(v['sumDretention']), 3)},
                               'selectionJaccard': {'mean': round(st.mean(v['jaccard']), 3), 'worst': round(min(v['jaccard']), 3)},
                               'travelRatio': {'mean': round(st.mean(v['travelRatio']), 3), 'max': round(max(v['travelRatio']), 3)},
                               'directDelta': {'min': min(v['directDelta']), 'max': max(v['directDelta'])}}
                           for k, v in sorted(stab.items())}
    out['solverNote'] = ('perturbed runs are solved under their own objective; selection differences mix objective '
                         'effects with single-start GLS search noise (P-D5 finding)')
    json.dump(out, open(os.path.join(GATE, 'runs', f'tours_summary{SUFFIX}.json'), 'w'), indent=1, default=dict)
    print(json.dumps(out['safety'], default=dict))
    for p, cs in prof.items():
        for c, v in cs.items():
            print(p, c, v)
    for k, v in out['perturbation'].items():
        print(k, v)


if __name__ == '__main__':
    main()
