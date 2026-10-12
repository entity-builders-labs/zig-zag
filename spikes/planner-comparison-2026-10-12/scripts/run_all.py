"""Run the pre-registered comparison (PROTOCOL.md). Writes runs/*.json and runs/summary.json."""
import json, os, sys, time, statistics, math
import common as C, planners as PL
import ortools
ROOT=C.ROOT; OUT=os.path.join(ROOT,'runs')
def pick_must(P,kind):
    if kind=='low_known':
        ks=[i for i in range(P.n) if P.cands[i]['kind']=='SINGLE' and P.unc[i]==0]
        return min(ks,key=lambda i:(P.cands[i]['desirability'],P.cands[i]['id']))
    if kind=='farthest':
        pts=[(P.visit_components(c)[0]['lat'],P.visit_components(c)[0]['lon']) for c in P.cands]
        cen=(sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts))
        return max(range(P.n),key=lambda i:(C.hav(pts[i],cen),P.cands[i]['id']))
def closed_window_must(city):
    """KNOWN-hours single closing earliest on day 1; day window starting after its last closing time"""
    P=C.Problem(city,30,1)
    best=None
    for i,c in enumerate(P.cands):
        if c['kind']!='SINGLE' or P.unc[i]: continue
        wins=c['components'][0]['hours']['weekly'][C.weekday(P.dates[0])]
        close=max((b for a,b in wins),default=0)
        if close<=1200 and (best is None or close<best[0]): best=(close,c['id'])
    return best
def scenarios(city):
    full=30
    S=[('S1-normal-p10',dict(pool_size=10,days=3)),('S1-normal-p20',dict(pool_size=20,days=3)),('S1-normal-pall',dict(pool_size=full,days=3)),
       ('S2-tight-hours',dict(pool_size=full,days=3,window=(780,1140))),
       ('S3-unknown-penalize',dict(pool_size=full,days=3)),('S3b-unknown-weight0',dict(pool_size=full,days=3,weights={'opening_hours_uncertainty_penalty':0})),
       ('S5-oversupply-1day',dict(pool_size=full,days=1)),('S6-spatial-walkonly-1day',dict(pool_size=full,days=1,modes=('walk',))),
       ('S9-anchors-none-p20',dict(pool_size=20,days=3)),('S9-anchors-start-p20',dict(pool_size=20,days=3,start_anchor=True)),('S9-anchors-startend-p20',dict(pool_size=20,days=3,start_anchor=True,end_anchor=True))]
    base=C.Problem(city,full,3)
    S.append(('S4-mustinclude',dict(pool_size=full,days=3,must=(base.cands[pick_must(base,'low_known')]['id'],base.cands[pick_must(base,'farthest')]['id']))))
    cw=closed_window_must(city)
    if cw: S.append(('S8-infeasible-must-closed',dict(pool_size=full,days=1,window=(cw[0]+60,min(cw[0]+240,1430)),must=(cw[1],))))
    return S
def solvers(budgets):
    out=[('greedy-current-walkrule',lambda P:PL.greedy_current(P,'walk_whenever_allowed')),('greedy-current-costmodes',lambda P:PL.greedy_current(P)),('greedy-insertion',PL.greedy_insertion)]
    for b in budgets:
        out.append((f'routing-{b}s',lambda P,b=b:PL.routing(P,b)))
        out.append((f'cpsat-dt{b}',lambda P,b=b:PL.cpsat(P,b)))
    return out
def plan_json(P,r):
    arcs=r.get('arcfn') or (lambda i,j:P.arcs[(i,j)])
    days=[]
    for d,items in enumerate(r['days']):
        legs=[]
        for k,it in enumerate(items):
            a=arcs(items[k-1]['i'],it['i']) if k else (P.from_hotel[it['i']] if P.start_anchor else None)
            legs.append({'id':P.cands[it['i']]['id'],'title':P.cands[it['i']]['title'],'start':it['start'],'end':round(it['start']+P.service[it['i']],1),
                         'incoming':None if not a else {'mode':a['mode'],'minutes':round(a['minutes'],1)},'uncertain_hours':P.unc[it['i']]>0})
        days.append({'date':P.dates[d],'items':legs})
    return days
def main():
    rows=[]
    for city in ('BA','PA','LA'):
        for sname,kw in scenarios(city):
            P=C.Problem(city,name=sname,**kw)
            budgets=[1,5,30] if sname=='S1-normal-pall' else ([1,5] if sname.startswith('S1') else [5])
            for solver,fn in solvers(budgets):
                reps=1 if ('30' in solver and sname=='S1-normal-pall') else (3 if sname.startswith('S1') else 1)
                outs=[]
                for _ in range(reps):
                    t=time.perf_counter(); r=fn(P); r['meta']['harness_wall_s']=round(time.perf_counter()-t,3); outs.append(r)
                r=outs[0]; viol=C.check(P,r); met=C.metrics(P,r)
                conflicts=r['meta'].get('must_conflicts') or []
                if r['meta']['status'] in ('MUST_CONFLICT','INFEASIBLE','NO_SOLUTION','MODEL_INVALID'): met['readiness']='PLANNER_INFEASIBLE (explicit)'
                identical=all(o['days']==r['days'] for o in outs)
                walls=[o['meta']['harness_wall_s'] for o in outs]
                row={'city':city,'scenario':sname,'solver':solver,'pool':P.n,'days':len(P.dates),'modes':P.modes,'anchors':[P.start_anchor,P.end_anchor],'must':list(P.must),
                     'pair_edges':P.edge_count(),'status':r['meta']['status'],'violations':viol,'valid':not viol or (r['meta']['status']=='MUST_CONFLICT' and all(x.startswith('mustInclude missing') for x in viol)),
                     'must_conflicts':conflicts,'repeats':reps,'identical_repeats':identical,'wall_s_median':round(statistics.median(walls),3),'wall_s_max':round(max(walls),3),
                     'solver_meta':{k:v for k,v in r['meta'].items() if k not in('harness_wall_s',)},**met,'itinerary':plan_json(P,r)}
                rows.append(row)
                json.dump(row,open(os.path.join(OUT,f"{city}__{sname}__{solver}.json"),'w'),indent=1)
                print(city,sname,solver,row['status'],'valid' if row['valid'] else 'INVALID',row['scheduled'],row['objective_test_weights'],row['wall_s_median'],file=sys.stderr)
    meta={'ortools':ortools.__version__,'python':sys.version.split()[0],'weights':C.WEIGHTS,'limits':C.LIMITS,'dates':C.DATES,'fixture_version':'pc-2026-10-12','routing_fixtures':'fixtures/*_matrix_*.json (Geoapify routematrix, recorded 2026-10-12)','cpsat':{'num_workers':1,'random_seed':7},'routing':{'first_solution':'PATH_CHEAPEST_ARC','metaheuristic':'GUIDED_LOCAL_SEARCH'}}
    json.dump({'meta':meta,'rows':[{k:v for k,v in r.items() if k!='itinerary'} for r in rows]},open(os.path.join(OUT,'summary.json'),'w'),indent=1)
if __name__=='__main__': main()
