"""POST-HOC (not in PROTOCOL.md): CP-SAT variants after the pre-registered configuration found no solution on full pools."""
import json, os, time
import common as C, planners as PL
rows=[]
for city in ('BA','PA','LA'):
    P=C.Problem(city,30,3,name='S1-normal-pall')
    hint=PL.greedy_insertion(P)
    for label,kw in [('w8-dt5',dict(det_time=5,workers=8)),('w8-dt30',dict(det_time=30,workers=8)),('w1-hint-dt5',dict(det_time=5,workers=1,hint=hint)),('w1-hint-dt30',dict(det_time=30,workers=1,hint=hint)),('w8-hint-dt5',dict(det_time=5,workers=8,hint=hint))]:
        outs=[PL.cpsat(P,**kw) for _ in range(2)]
        r=outs[0]; v=C.check(P,r); m=C.metrics(P,r)
        row={'city':city,'variant':label,'status':r['meta']['status'],'violations':v,'scheduled':m['scheduled'],'objective_test_weights':m['objective_test_weights'],
             'solver_objective':r['meta'].get('objective'),'bound':r['meta'].get('bound'),'wall_s':[o['meta']['wall_s'] for o in outs],'identical_repeats':outs[0]['days']==outs[1]['days'],
             'variables':r['meta'].get('variables'),'constraints':r['meta'].get('constraints'),'hint_objective':C.metrics(P,hint)['objective_test_weights']}
        rows.append(row); print(city,label,row['status'],row['scheduled'],row['objective_test_weights'],'hint',row['hint_objective'],'bound',row['bound'],row['wall_s'],row['identical_repeats'],'viol',v[:1])
json.dump(rows,open(os.path.join(C.ROOT,'runs','posthoc_cpsat.json'),'w'),indent=1)
