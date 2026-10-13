"""Summarize ../runs/stop_policies.json per policy against the recorded P11 runs (quality retention,
determinism, runtime). Prints a Markdown table and writes ../runs/stop_policies_summary.json."""
import json, os, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__)); RUNS = os.path.join(os.path.dirname(HERE), 'runs')
data = json.load(open(os.path.join(RUNS, sys.argv[1] if len(sys.argv) > 1 else 'stop_policies.json')))
CONSTRAINED = {'S2-tight-hours', 'S5-oversupply-1day', 'S1-normal-p20', 'S9-anchors-startend-p20'}


def best_recorded_routing(rec):
    vals = [v['obj'] for k, v in rec.items() if k.startswith('routing')]
    return max(vals) if vals else None


out = {}
for pol in data['meta']['policies']:
    rows = [r for r in data['rows'] if r['policy'] == pol]
    planned = [r for r in rows if r['status'] == 'PLANNED']
    vs5, vsbest, vsgi, worse1 = [], [], [], []
    for r in planned:
        rec = r['recorded']; r5 = rec.get('routing-5s', {}).get('obj'); rb = best_recorded_routing(rec); gi = rec.get('greedy-insertion', {}).get('obj')
        if r5: vs5.append(r['obj'] / r5 - 1)
        if rb: vsbest.append(r['obj'] / rb - 1)
        if gi: vsgi.append(r['obj'] / gi - 1)
        if r5 and r['obj'] < r5 * 0.99: worse1.append(f"{r['city']} {r['scenario']} {100 * (r['obj'] / r5 - 1):+.1f}%")
    big = [ms for r in planned if r['scenario'] in ('S1-normal-pall', 'S3-unknown-penalize', 'S4-mustinclude', 'S2-tight-hours') for ms in r['solveMs']]
    cons = [r['obj'] / r['recorded']['greedy-insertion']['obj'] - 1 for r in planned
            if r['scenario'] in CONSTRAINED and r['recorded'].get('greedy-insertion', {}).get('obj')]
    out[pol] = {
        'runs': len(rows), 'planned': len(planned), 'explicitInfeasible': sum(r['status'] == 'INFEASIBLE' for r in rows),
        'failed': sum(r['status'] == 'OPTIMIZER_FAILED' for r in rows),
        # INFEASIBLE rows return no plan; the P11 checker's "mustInclude missing" there is the explicit conflict itself
        'violations': sum(len(r['violations']) for r in planned),'identicalRepeats': f"{sum(r['identical_repeats'] for r in rows)}/{len(rows)}",
        'capHit': sum(bool(r['capHit']) for r in rows),
        'vsRouting5sMeanPct': round(100 * statistics.mean(vs5), 2), 'vsRouting5sMinPct': round(100 * min(vs5), 2),
        'vsBestRecordedRoutingMeanPct': round(100 * statistics.mean(vsbest), 2),
        'vsGreedyInsertionMeanPct': round(100 * statistics.mean(vsgi), 2),
        'vsGreedyInsertionConstrainedMeanPct': round(100 * statistics.mean(cons), 2) if cons else None,
        'worseThanRouting5sBy1pct': worse1,
        'solveMs30pool': {'median': round(statistics.median(big)), 'max': round(max(big))} if big else None,
    }
json.dump(out, open(os.path.join(RUNS, 'stop_policies_summary.json'), 'w'), indent=1)
print('| policy | violations | identical repeats | vs Routing 5 s (mean / worst) | vs greedy best-insertion (all / constrained) | solve ms ~30-pool (median / max) | >1 % below Routing 5 s |')
print('|---|---|---|---|---|---|---|')
for p, s in out.items():
    sm = s['solveMs30pool'] or {}
    print(f"| {p} | {s['violations']} | {s['identicalRepeats']} | {s['vsRouting5sMeanPct']:+.2f} % / {s['vsRouting5sMinPct']:+.2f} % | "
          f"{s['vsGreedyInsertionMeanPct']:+.2f} % / {s['vsGreedyInsertionConstrainedMeanPct']:+.2f} % | {sm.get('median')} / {sm.get('max')} | "
          f"{len(s['worseThanRouting5sBy1pct'])} |")
