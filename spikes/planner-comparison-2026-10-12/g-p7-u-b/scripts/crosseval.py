"""Best-known cross-evaluation (P-D5 sensitivity under the G-P7-U.B check point): every plan produced for
the same (city, scenario, profile) by any parameter point is re-scored under the check-point objective;
the check-point SL1000 plan is compared with the best of them. Writes runs/crosseval.json."""
import collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); GATE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import tours as T   # noqa: E402
SUFFIX = T.SUFFIX


def main():
    rows = json.load(open(os.path.join(GATE, 'runs', f'tours{SUFFIX}.json')))['rows']
    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r['city'], r['scenario'], r['profile'])].append(r)
    out = []
    for (city, scen, prof), rs in sorted(groups.items()):
        modes = T.PROFILES[prof]
        P = T.problem(city, scen, modes)
        req, cls, prize = T.build(P, T.SIMPLE, modes)
        vals = {}
        for r in rs:
            m = T.evaluate(P, req, {'status': 'PLANNED', 'days': r['plan']}, cls, prize, T.SIMPLE)
            vals[r['label']] = m['value']
        best = max(vals.values()); own = vals['simple']
        out.append({'city': city, 'scenario': scen, 'profile': prof, 'checkPointValue': own, 'bestKnown': best,
                    'bestBy': max(vals, key=vals.get), 'gapPct': round(100 * (best - own) / abs(best), 2) if best else 0.0,
                    'plansCompared': len(vals)})
    gaps = [o['gapPct'] for o in out]
    summary = {'problems': len(out), 'over1pct': sum(1 for g in gaps if g > 1), 'max': max(gaps),
               'mean': round(sum(gaps) / len(gaps), 2), 'exact': sum(1 for g in gaps if g <= 0)}
    json.dump({'summary': summary, 'rows': out}, open(os.path.join(GATE, 'runs', f'crosseval{SUFFIX}.json'), 'w'), indent=1)
    print(summary)
    for o in sorted(out, key=lambda o: -o['gapPct'])[:8]:
        print(o)


if __name__ == '__main__':
    main()
