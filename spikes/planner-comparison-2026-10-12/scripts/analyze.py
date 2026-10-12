import json, os, collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S=json.load(open(os.path.join(ROOT,'runs','summary.json'))); R=S['rows']
def fmt(r):
    st=r['status']; ok='ok' if r['valid'] and st not in('UNKNOWN',) else ('NO-SOL' if st=='UNKNOWN' else 'FAIL')
    return f"{ok:6s} n={r['scheduled']:2d} D={r['desirability']:6.2f} obj={r['objective_test_weights']:8.1f} trav={r['travel_min']:6.1f} walk={r['walk_min']:5.1f} drv={r['drive_legs']:2d} unk={r['unknown_hours_scheduled']:2d} idle={r['idle_min']:6.1f} t={r['wall_s_median']:6.3f}/{r['wall_s_max']:6.3f} rep={'=' if r['identical_repeats'] else '≠'} {r['readiness'][:22]}"
out=[]
for city in ('BA','PA','LA'):
    for scen in sorted({r['scenario'] for r in R if r['city']==city}):
        out.append(f"\n## {city} {scen}")
        for r in [x for x in R if x['city']==city and x['scenario']==scen]:
            extra=''
            m=r['solver_meta']
            if 'bound' in m and m.get('objective') is not None: extra=f" gap={(m['bound']-m['objective'])/max(1,abs(m['objective'])):.3%}"
            out.append(f"  {r['solver']:26s} {r['status']:13s} {fmt(r)}{extra}")
print("\n".join(out))
