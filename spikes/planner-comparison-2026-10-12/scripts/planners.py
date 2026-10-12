"""Planner implementations for the comparison spike. All consume common.Problem; outputs {'days':[[{'i','start'}]],'meta':{}}."""
import math, time
from common import WEIGHTS
CEIL=math.ceil
def svc(P,i): return CEIL(P.service[i]-1e-9)
def tr(a): return CEIL(a['minutes']-1e-9)
# ---------------------------------------------------------------- schedule helper (earliest feasible start times)
def schedule_day(P,d,order,arcfn=None):
    arcfn=arcfn or (lambda i,j:P.arcs[(i,j)])
    t=P.window[0]; walk=0.0; out=[]; prev=None
    for k,i in enumerate(order):
        if k==0 and P.start_anchor:
            a=P.from_hotel[i]
            if a is None: return None
            t+=tr(a); walk+=a['walk_min']
        if prev is not None:
            a=arcfn(prev,i)
            if a is None: return None
            t=t+tr(a); walk+=a['walk_min']
        s=None
        for lo,hi in P.ivs[i][d]:
            if t<=hi: s=max(t,lo); break
        if s is None: return None
        out.append({'i':i,'start':s}); t=s+svc(P,i); prev=i
    if order and P.end_anchor:
        a=P.to_hotel[order[-1]]
        if a is None or t+tr(a)>P.window[1]: return None
        walk+=a['walk_min']
    if walk>P.limits['daily_walk_budget_min']+1e-9: return None
    return out
def obj_day(P,order,arcfn=None):
    arcfn=arcfn or (lambda i,j:P.arcs[(i,j)])
    v=sum(P.value[i]-P.weights['opening_hours_uncertainty_penalty']*P.unc[i] for i in order)
    c=sum(arcfn(a,b)['cost'] for a,b in zip(order,order[1:]))
    if order and P.start_anchor: c+=P.from_hotel[order[0]]['cost']
    if order and P.end_anchor: c+=P.to_hotel[order[-1]]['cost']
    return v-c
# ---------------------------------------------------------------- greedy port of the current planner
def walk_whenever_allowed(P):
    """current provider rule (pickMode): WALKING whenever allowed and estimable, else drive"""
    def arcfn(i,j):
        a=P.arcs[(i,j)]
        if 'walk' in P.modes:
            t=P.M['walk']['time_s'][P.point(P.cands[i],True)][P.point(P.cands[j],False)]
            if t is not None:
                mins=t/60
                if mins>P.limits['max_continuous_walk_min']: return None   # walking chosen, then rejected by the walking limit
                return {'mode':'walk','minutes':mins,'walk_min':mins,'cost':P.weights['walk_cost_per_min']*mins,'distance_m':0}
        return a
    return arcfn
def greedy_current(P,mode_rule='cost'):
    t0=time.perf_counter()
    arcfn=walk_whenever_allowed(P) if mode_rule=='walk_whenever_allowed' else None
    af=arcfn or (lambda i,j:P.arcs[(i,j)])
    order=sorted(range(P.n),key=lambda i:(i not in P.must_idx,-P.cands[i]['desirability'],P.cands[i]['id']))
    days=[[] for _ in P.dates]; used=[0.0]*len(P.dates); unselected=[]
    cap=P.window[1]-P.window[0]
    for i in order:   # placement: best-scoring feasible day by capacity (append travel), day-balance bonus
        best=None
        for d in range(len(P.dates)):
            if not P.ivs[i][d]: continue
            add=svc(P,i)+(tr(af(days[d][-1],i)) if days[d] and af(days[d][-1],i) else 0)
            if days[d] and af(days[d][-1],i) is None: continue
            if used[d]+add>cap: continue
            score=P.cands[i]['desirability']+0.1*(1/(len(days[d])+1))
            if best is None or score>best[0]: best=(score,d,add)
        if best is None: unselected.append(i); continue
        days[best[1]].append(i); used[best[1]]+=best[2]
    plan=[]
    for d,assigned in enumerate(days):  # per-day nearest-feasible ordering with repair (drop lowest priority)
        assigned=list(assigned)
        while True:
            seq=[]; remaining=list(assigned); ok=True
            while remaining:
                cands=[]
                for j in remaining:
                    trial=seq+[j]
                    if schedule_day(P,d,trial,arcfn) is None: continue
                    dist=af(seq[-1],j)['minutes'] if seq else (P.from_hotel[j]['minutes'] if P.start_anchor and P.from_hotel[j] else 0)
                    cands.append((dist,P.cands[j]['id'],j))
                if not cands: ok=False; break
                j=min(cands)[2]; seq.append(j); remaining.remove(j)
            if ok and schedule_day(P,d,seq,arcfn) is not None: break
            drop=sorted(assigned,key=lambda i:(i in P.must_idx,P.cands[i]['desirability'],P.cands[i]['id']))[0]
            assigned.remove(drop); unselected.append(drop)
        plan.append(schedule_day(P,d,seq,arcfn) or [])
    conflicts=[P.cands[i]['id'] for i in P.must_idx if i in unselected]
    return {'days':plan,'meta':{'solver':f'greedy-current({mode_rule})','wall_s':round(time.perf_counter()-t0,4),'status':'MUST_CONFLICT' if conflicts else 'HEURISTIC','must_conflicts':conflicts},'arcfn':arcfn}
# ---------------------------------------------------------------- greedy best insertion (improved greedy)
def greedy_insertion(P):
    t0=time.perf_counter(); days=[[] for _ in P.dates]; left=set(range(P.n))
    while True:
        best=None
        for i in sorted(left):
            for d in range(len(P.dates)):
                if not P.ivs[i][d]: continue
                base=obj_day(P,days[d])
                for pos in range(len(days[d])+1):
                    trial=days[d][:pos]+[i]+days[d][pos:]
                    if any(P.arcs[(a,b)] is None for a,b in zip(trial,trial[1:])): continue
                    if P.start_anchor and P.from_hotel[trial[0]] is None: continue
                    if P.end_anchor and P.to_hotel[trial[-1]] is None: continue
                    if schedule_day(P,d,trial) is None: continue
                    gain=obj_day(P,trial)-base
                    key=(i in P.must_idx,gain,-i)
                    if best is None or key>best[0]: best=(key,i,d,trial)
        if best is None: break
        (is_must,gain,_),i,d,trial=best
        if not is_must and gain<=0: break
        days[d]=trial; left.discard(i)
    plan=[schedule_day(P,d,days[d]) or [] for d in range(len(P.dates))]
    conflicts=[P.cands[i]['id'] for i in P.must_idx if i in left]
    return {'days':plan,'meta':{'solver':'greedy-insertion','wall_s':round(time.perf_counter()-t0,4),'status':'MUST_CONFLICT' if conflicts else 'HEURISTIC','must_conflicts':conflicts}}
# ---------------------------------------------------------------- OR-Tools Routing
def routing(P,time_limit_s=5):
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    t0=time.perf_counter()
    D=len(P.dates); DAY=1440
    nodes=[]
    if not (P.start_anchor and P.end_anchor): nodes.append(('DUMMY',None,None))   # free depot (no first/last mile)
    if P.start_anchor or P.end_anchor: nodes.append(('HOTEL',None,None))
    dep={k[0]:n for n,k in enumerate(nodes)}
    for i in range(P.n):
        for d in range(D):
            if P.ivs[i][d]: nodes.append(('C',i,d))
    starts=[dep['HOTEL'] if P.start_anchor else dep['DUMMY']]*D; ends=[dep['HOTEL'] if P.end_anchor else dep['DUMMY']]*D
    mgr=pywrapcp.RoutingIndexManager(len(nodes),D,starts,ends); R=pywrapcp.RoutingModel(mgr)
    BIG=10**6
    def arc_of(a,b):
        ka,kb=nodes[a],nodes[b]
        if ka[0]=='C' and kb[0]=='C': return None if ka[1]==kb[1] else P.arcs[(ka[1],kb[1])]
        if ka[0]=='HOTEL' and kb[0]=='C': return P.from_hotel[kb[1]]
        if ka[0]=='C' and kb[0]=='HOTEL': return P.to_hotel[ka[1]]
        return {'minutes':0,'walk_min':0,'cost':0}
    def time_cb(fi,ti):
        a,b=mgr.IndexToNode(fi),mgr.IndexToNode(ti); s=svc(P,nodes[a][1]) if nodes[a][0]=='C' else 0
        arc=arc_of(a,b); return s+(tr(arc) if arc else BIG)
    def cost_cb(fi,ti):
        arc=arc_of(mgr.IndexToNode(fi),mgr.IndexToNode(ti)); return round(arc['cost']) if arc else BIG
    def walk_cb(fi,ti):
        arc=arc_of(mgr.IndexToNode(fi),mgr.IndexToNode(ti)); return CEIL(arc['walk_min']*10) if arc else BIG
    tcb=R.RegisterTransitCallback(time_cb); ccb=R.RegisterTransitCallback(cost_cb); wcb=R.RegisterTransitCallback(walk_cb)
    R.SetArcCostEvaluatorOfAllVehicles(ccb)
    R.AddDimension(tcb,24*60,D*DAY,False,'Time'); T=R.GetDimensionOrDie('Time')
    R.AddDimension(wcb,0,P.limits['daily_walk_budget_min']*10,True,'Walk')
    for v in range(D):
        T.CumulVar(R.Start(v)).SetRange(v*DAY+P.window[0],v*DAY+P.window[1]); T.CumulVar(R.End(v)).SetRange(v*DAY+P.window[0],v*DAY+P.window[1])
    copies={}
    for n,(k,i,d) in enumerate(nodes):
        if k!='C': continue
        idx=mgr.NodeToIndex(n); R.VehicleVar(idx).SetValues([-1,d]); copies.setdefault(i,[]).append(idx)
        ivs=P.ivs[i][d]; cv=T.CumulVar(idx); cv.SetRange(d*DAY+ivs[0][0],d*DAY+ivs[-1][1])
        for (a,b),(c,_) in zip(ivs,ivs[1:]):
            if c>b+1: cv.RemoveInterval(d*DAY+b+1,d*DAY+c-1)
    missing=[P.cands[i]['id'] for i in P.must_idx if i not in copies]
    if missing:
        return {'days':[[] for _ in range(D)],'meta':{'solver':f'ortools-routing(gls,{time_limit_s}s)','wall_s':round(time.perf_counter()-t0,3),'solve_s':0,'status':'MUST_CONFLICT','must_conflicts':missing,'nodes':len(nodes)}}
    for i,idxs in copies.items():
        net=max(0,P.value[i]-P.weights['opening_hours_uncertainty_penalty']*P.unc[i])
        if i in P.must_idx: R.AddDisjunction(idxs)   # exactly one copy, mandatory
        else: R.AddDisjunction(idxs,net,1)
    for a in range(len(nodes)):
        for b in range(len(nodes)):
            if a!=b and nodes[a][0]=='C' and nodes[b][0]=='C' and (nodes[a][2]!=nodes[b][2] or arc_of(a,b) is None):
                R.NextVar(mgr.NodeToIndex(a)).RemoveValue(mgr.NodeToIndex(b))
    sp=pywrapcp.DefaultRoutingSearchParameters()
    sp.first_solution_strategy=routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    sp.local_search_metaheuristic=routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    sp.time_limit.FromMilliseconds(int(time_limit_s*1000))
    tb=time.perf_counter(); sol=R.SolveWithParameters(sp); ts=time.perf_counter()-tb
    plan=[[] for _ in range(D)]
    if sol:
        for v in range(D):
            idx=sol.Value(R.NextVar(R.Start(v)))
            while not R.IsEnd(idx):
                k,i,d=nodes[mgr.IndexToNode(idx)]
                plan[v].append({'i':i,'start':sol.Min(T.CumulVar(idx))-v*DAY}); idx=sol.Value(R.NextVar(idx))
    return {'days':plan,'meta':{'solver':f'ortools-routing(gls,{time_limit_s}s)','wall_s':round(time.perf_counter()-t0,3),'solve_s':round(ts,3),
            'status':'FEASIBLE' if sol else 'NO_SOLUTION','nodes':len(nodes),'objective_cost':sol.ObjectiveValue() if sol else None}}
# ---------------------------------------------------------------- OR-Tools CP-SAT
def cpsat(P,det_time=5,seed=7,workers=1,hint=None):
    from ortools.sat.python import cp_model
    from ortools.util.python import sorted_interval_list as sil
    t0=time.perf_counter(); m=cp_model.CpModel(); D=len(P.dates)
    pres={}; obj=[]; nvars=0; arcvars={}
    for d in range(D):
        nodes=[i for i in range(P.n) if P.ivs[i][d]]
        arcs=[]; s={}
        for i in nodes:
            ivs=P.ivs[i][d]; s[i]=m.NewIntVarFromDomain(sil.Domain.FromIntervals([[a,b] for a,b in ivs]),f's{d}_{i}')
            p=m.NewBoolVar(f'p{d}_{i}'); pres[(d,i)]=p; arcs.append((i+1,i+1,p.Not()))
        empty=m.NewBoolVar(f'empty{d}'); arcs.append((0,0,empty))
        walk=[]
        for i in nodes:   # depot arcs
            a_in=m.NewBoolVar(''); a_out=m.NewBoolVar(''); arcs+= [(0,i+1,a_in),(i+1,0,a_out)]
            if P.start_anchor:
                fh=P.from_hotel[i]
                if fh is None: m.Add(a_in==0)
                else: m.Add(s[i]>=P.window[0]+tr(fh)).OnlyEnforceIf(a_in); obj.append(-round(fh['cost'])*a_in); walk.append((CEIL(fh['walk_min']*10),a_in))
            if P.end_anchor:
                th=P.to_hotel[i]
                if th is None: m.Add(a_out==0)
                else: m.Add(s[i]+svc(P,i)+tr(th)<=P.window[1]).OnlyEnforceIf(a_out); obj.append(-round(th['cost'])*a_out); walk.append((CEIL(th['walk_min']*10),a_out))
            m.Add(s[i]+svc(P,i)<=P.window[1]).OnlyEnforceIf(pres[(d,i)])
        for i in nodes:
            for j in nodes:
                if i==j: continue
                a=P.arcs[(i,j)]
                if a is None: continue
                x=m.NewBoolVar(''); arcs.append((i+1,j+1,x)); arcvars[(d,i,j)]=x
                m.Add(s[j]>=s[i]+svc(P,i)+tr(a)).OnlyEnforceIf(x)
                obj.append(-round(a['cost'])*x)
                if a['walk_min']>0: walk.append((CEIL(a['walk_min']*10),x))
        m.AddCircuit(arcs); nvars+=len(arcs)+len(nodes)
        if walk: m.Add(sum(w*x for w,x in walk)<=P.limits['daily_walk_budget_min']*10)
    for i in range(P.n):
        ps=[pres[(d,i)] for d in range(D) if (d,i) in pres]
        if i in P.must_idx:
            if not ps:
                return {'days':[[] for _ in range(D)],'meta':{'solver':f'cp-sat(dt={det_time},seed={seed},workers={workers},hint={bool(hint)})','wall_s':round(time.perf_counter()-t0,3),'solve_s':0,'status':'MUST_CONFLICT','must_conflicts':[P.cands[i]['id']]}}
            m.Add(sum(ps)==1)
        elif ps: m.Add(sum(ps)<=1)
        net=P.value[i]-P.weights['opening_hours_uncertainty_penalty']*P.unc[i]
        obj+= [net*p for p in ps]
    m.Maximize(sum(obj))
    if hint:   # warm start from another planner's plan (post-hoc variant)
        hd={it['i']:d for d,items in enumerate(hint['days']) for it in items}
        for (d,i),p in pres.items(): m.AddHint(p,1 if hd.get(i)==d else 0)
        for d,items in enumerate(hint['days']):
            for a,b in zip(items,items[1:]):
                if (d,a['i'],b['i']) in arcvars: m.AddHint(arcvars[(d,a['i'],b['i'])],1)
    sv=cp_model.CpSolver(); sv.parameters.max_deterministic_time=det_time; sv.parameters.num_workers=workers; sv.parameters.random_seed=seed
    tb=time.perf_counter(); st=sv.Solve(m); ts=time.perf_counter()-tb
    return _cpsat_extract(P,m,sv,st,pres,t0,ts,nvars,det_time,seed,workers)
def _cpsat_extract(P,m,sv,st,pres,t0,ts,nvars,det_time,seed,workers):
    from ortools.sat.python import cp_model
    D=len(P.dates); plan=[[] for _ in range(D)]
    if st in (cp_model.OPTIMAL,cp_model.FEASIBLE):
        proto=m.Proto()
        for idx,var in enumerate(proto.variables):
            if var.name.startswith('s'):
                d,i=map(int,var.name[1:].split('_'))
                if sv.Value(pres[(d,i)]): plan[d].append({'i':i,'start':sv.Value(m.GetIntVarFromProtoIndex(idx))})
        for d in range(D): plan[d].sort(key=lambda x:x['start'])
    status=sv.StatusName(st)
    return {'days':plan,'meta':{'solver':f'cp-sat(dt={det_time},seed={seed},workers={workers})','wall_s':round(time.perf_counter()-t0,3),'solve_s':round(ts,3),'status':status,
            'objective':sv.ObjectiveValue() if st in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,'bound':sv.BestObjectiveBound() if st in (cp_model.OPTIMAL,cp_model.FEASIBLE) else None,
            'variables':len(m.Proto().variables),'constraints':len(m.Proto().constraints)}}
