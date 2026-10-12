import json, os, glob, statistics
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S=json.load(open(os.path.join(ROOT,'runs','summary.json'))); R=S['rows']; PH=json.load(open(os.path.join(ROOT,'runs','posthoc_cpsat.json')))
def row(c,s,v): 
    x=[r for r in R if r['city']==c and r['scenario']==s and r['solver']==v]; return x[0] if x else None
SOLV=['greedy-current-walkrule','greedy-current-costmodes','greedy-insertion','routing-1s','routing-5s','cpsat-dt5']
SC=['S1-normal-p10','S1-normal-p20','S1-normal-pall','S2-tight-hours','S3-unknown-penalize','S3b-unknown-weight0','S4-mustinclude','S5-oversupply-1day','S6-spatial-walkonly-1day','S8-infeasible-must-closed','S9-anchors-none-p20','S9-anchors-start-p20','S9-anchors-startend-p20']
def cell(r):
    if r is None: return '–'
    if r['status']=='UNKNOWN': return 'no solution'
    if r['status']=='MUST_CONFLICT': return 'conflict (explicit)'
    return f"{r['objective_test_weights']:.0f} / {r['scheduled']}"
L=["# Planner comparison (P-D5 / P-D7 evidence) — 2026-10-12\n",
"Pre-registered in `PROTOCOL.md`. Fixtures `fixtures/` (frozen; raw provider responses in `fixtures/raw/`), recorded Geoapify walk/drive matrices replayed for every solver, independent hard-constraint checker `scripts/check` (in `common.py`). Reproduce: `scripts/build_fixtures.py` → `scripts/record_travel.py` (needs `GEOAPIFY_API_KEY`; outputs already recorded) → `scripts/run_all.py` → `scripts/run_posthoc_cpsat.py` → `scripts/analyze.py` → `scripts/report.py`.\n",
f"Run manifest: OR-Tools {S['meta']['ortools']}, Python {S['meta']['python']}; test-only weights {S['meta']['weights']}; limits {S['meta']['limits']}; dates {S['meta']['dates']}; CP-SAT {S['meta']['cpsat']}; Routing {S['meta']['routing']}.\n",
"## Correctness\n",
f"- {len(R)} pre-registered runs + {len(PH)} post-hoc CP-SAT runs; every produced itinerary passed the checker (day windows, KNOWN opening windows incl. the composite's internal Mercado visit, known-closed days, travel-time consistency with the recorded matrix and chosen mode, continuous-walking limit, daily walking budget, mustInclude, duplicates, anchors).",
f"- Hard-constraint violations by any produced Tour: **0**.",
f"- Failures to produce a Tour when one exists: pre-registered CP-SAT (1 worker) returned UNKNOWN on {sum(1 for r in R if r['status']=='UNKNOWN')} runs (all ~30-candidate pools in every city and LA pool 20 at dt=1).",
f"- Explicit conflicts: S8 in all cities and LA S4 (its pre-registered must-include, the Chinese American Museum, opens Fr-Su only; trip Tue-Thu) — every solver reported the conflict; Routing/CP-SAT before solving, greedy after placement.\n",
"## Objective (test weights) / scheduled Experiences\n",
"| City | Scenario | "+" | ".join(SOLV)+" |","|---|---|"+"---|"*len(SOLV)]
for c in ('BA','PA','LA'):
    for s in SC:
        L.append(f"| {c} | {s} | "+" | ".join(cell(row(c,s,v)) for v in SOLV)+" |")
L+=["\nReference budgets on the ~30-candidate pools: "+"; ".join(f"{c} routing-30s {cell(row(c,'S1-normal-pall','routing-30s'))}" for c in ('BA','PA','LA'))+".\n",
"## Runtime (wall seconds, median / max of 3 repetitions; Routing and CP-SAT are budget-bound)\n",
"| City | Pool | greedy-current | greedy-insertion | routing-1s | routing-5s | cpsat-dt1 | cpsat-dt5 | arcs |","|---|---|---|---|---|---|---|---|---|"]
for c in ('BA','PA','LA'):
    for s in ('S1-normal-p10','S1-normal-p20','S1-normal-pall'):
        g=row(c,s,'greedy-current-costmodes'); gi=row(c,s,'greedy-insertion')
        def t(v):
            r=row(c,s,v); return '–' if not r else (f"{r['wall_s_median']}/{r['wall_s_max']}"+(' (no sol.)' if r['status']=='UNKNOWN' else '')+(f" {r['status'].lower()}" if v.startswith('cpsat') and r['status']=='OPTIMAL' else ''))
        L.append(f"| {c} | {g['pool']} | {t('greedy-current-costmodes')} | {t('greedy-insertion')} | {t('routing-1s')} | {t('routing-5s')} | {t('cpsat-dt1')} | {t('cpsat-dt5')} | {g['pair_edges']} |")
L+=["\nRepeated runs were identical for every greedy, Routing and 1-worker CP-SAT configuration (Routing is time-limited GLS: identical here, but a time limit is not a deterministic stop criterion in principle).\n",
"## Post-hoc CP-SAT variants (not pre-registered; S1 ~30 candidates)\n","| City | Variant | Status | Objective / n | Upper bound | Hint (greedy-insertion) | Wall s (2 runs) | Identical |","|---|---|---|---|---|---|---|---|"]
for p in PH: L.append(f"| {p['city']} | {p['variant']} | {p['status']} | {p['objective_test_weights']:.0f} / {p['scheduled']} | {p['bound']} | {p['hint_objective']:.0f} | {p['wall_s']} | {p['identical_repeats']} |")
L.append("\n## Representative itineraries (S1, ~30 candidates, Routing 5 s vs greedy best-insertion)\n")
for c in ('BA','PA','LA'):
    for v in ('routing-5s','greedy-insertion'):
        r=json.load(open(os.path.join(ROOT,'runs',f'{c}__S1-normal-pall__{v}.json')))
        L.append(f"**{c} — {v}** (objective {r['objective_test_weights']:.0f}, {r['scheduled']} Experiences, travel {r['travel_min']} min, walking {r['walk_min']} min, idle {r['idle_min']} min, UNKNOWN-hours visits {r['unknown_hours_scheduled']})\n")
        for d in r['itinerary']:
            L.append(f"- {d['date']}: "+" → ".join(f"{it['start']//60:02d}:{it['start']%60:02d} {it['title'][:28]}{' (hours unknown)' if it['uncertain_hours'] else ''}"+(f" [{it['incoming']['mode']} {round(it['incoming']['minutes'])}′]" if it['incoming'] else '') for it in d['items']))
        L.append("")
open(os.path.join(ROOT,'RESULTS.md'),'w').write("\n".join(L)+"\n"); print('ok')
