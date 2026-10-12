"""Shared problem model for the planner comparison (replays recorded travel; no speed estimates).
Times are destination-local minutes. All solvers receive the same Problem and are checked by check()."""
import json, os, math, datetime
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
WEIGHTS={'desirability_per_unit':1000,'walk_cost_per_min':10,'drive_cost_per_min':20,'drive_leg_cost':100,
         'opening_hours_uncertainty_penalty':100,'idle_cost_per_min':0}   # TEST-ONLY, not P-D7
LIMITS={'max_continuous_walk_min':30,'daily_walk_budget_min':150}
MIN_USEFUL_RESIDUAL_MIN=60   # existing planner policy dailyPlanningPolicy.backfill.minimumUsefulResidualMinutes (default)
DATES=['2026-11-10','2026-11-11','2026-11-12']
WD=['Mo','Tu','We','Th','Fr','Sa','Su']
def weekday(date): return WD[datetime.date.fromisoformat(date).weekday()]
class Problem:
    def __init__(self,city,pool_size,days,window=(540,1140),modes=('walk','drive'),must=(),start_anchor=False,end_anchor=False,weights=None,name=''):
        self.city=city; self.name=name; self.fx=json.load(open(os.path.join(ROOT,'fixtures',f'{city}.json')))
        self.weights=dict(WEIGHTS,**(weights or {})); self.limits=dict(LIMITS); self.modes=list(modes)
        ranked=sorted(self.fx['candidates'],key=lambda x:(-x['desirability'],x['id']))
        comp=[x for x in ranked if x['kind']=='COMPOSITE']
        pool=ranked[:pool_size]
        if comp and comp[0] not in pool: pool=pool[:-1]+comp   # composite always present when the fixture has one
        self.cands=pool; self.dates=DATES[:days]; self.window=window
        self.must=[c for c in must]; self.start_anchor=start_anchor; self.end_anchor=end_anchor
        self.M={m:json.load(open(os.path.join(ROOT,'fixtures',f'{city}_matrix_{m}.json'))) for m in ('walk','drive')}
        self.pidx={p['pid']:i for i,p in enumerate(self.M['walk']['points'])}
        leg=os.path.join(ROOT,'fixtures',f'{city}_composite_internal_leg.json')
        self.internal_leg=json.load(open(leg)) if os.path.exists(leg) else None
        self.n=len(self.cands); self._prep()
    # ---- candidate timing
    def visit_components(self,c): return [k for k in c['components'] if k['participation']=='VISIT']
    def timeline(self,c):
        """list of (offset_min, duration_min, component) for VISIT components, and total service minutes"""
        if c['kind']=='SINGLE':
            k=c['components'][0]; return [(0,k['duration_min'],k)],k['duration_min']
        t=[k for k in c['components'] if k['participation']=='TRAVERSE'][0]; v=self.visit_components(c)[0]
        off=t['traverse_min']+self.internal_leg['time_s']/60
        return [(off,v['duration_min'],v)],off+v['duration_min']
    def start_intervals(self,c,date):
        """feasible start times [a,b] from KNOWN windows of every internal VISIT component (UNKNOWN imposes none)"""
        tl,total=self.timeline(c); wd=weekday(date)
        ivs=[(self.window[0],self.window[1]-total)]
        for off,dur,k in tl:
            h=k['hours']
            if h['status']!='KNOWN': continue
            wins=h['weekly'][wd]; new=[]
            for a,b in ivs:
                for o,cl in wins:
                    lo=max(a,o-off); hi=min(b,cl-off-dur)
                    if lo<=hi: new.append((lo,hi))
            ivs=new
        return [(math.ceil(a),math.floor(b)) for a,b in ivs if math.ceil(a)<=math.floor(b)]
    def uncertain(self,c): return sum(1 for k in self.visit_components(c) if k['hours']['status']!='KNOWN')
    def point(self,c,end):
        if c=='HOTEL': return self.pidx['HOTEL']
        if c['kind']=='SINGLE': return self.pidx[c['id']]
        return self.pidx[c['id']+('#end' if end else '#start')]
    # ---- arcs with per-arc mode choice (dominated-mode pruning under the continuous-walking limit)
    def arc(self,a,b):
        """a,b are point indices. Returns dict(mode,minutes,walk_min,cost) or None"""
        best=None
        for m in self.modes:
            t=self.M[m]['time_s'][a][b]
            if t is None: continue
            mins=t/60
            if m=='walk':
                if mins>self.limits['max_continuous_walk_min']: continue
                cost=self.weights['walk_cost_per_min']*mins; walk=mins
            else:
                cost=self.weights['drive_cost_per_min']*mins+(self.weights['drive_leg_cost'] if a!=b else 0); walk=0
            cand={'mode':m,'minutes':mins,'walk_min':walk,'cost':cost,'distance_m':self.M[m]['distance_m'][a][b]}
            if best is None or (cand['cost'],cand['mode'])<(best['cost'],best['mode']): best=cand
        return best
    def _prep(self):
        self.service=[self.timeline(c)[1] for c in self.cands]
        self.value=[round(self.weights['desirability_per_unit']*c['desirability']) for c in self.cands]
        self.unc=[self.uncertain(c) for c in self.cands]
        self.ivs=[[self.start_intervals(c,d) for d in self.dates] for c in self.cands]
        self.arcs={}
        for i,ci in enumerate(self.cands):
            for j,cj in enumerate(self.cands):
                if i!=j: self.arcs[(i,j)]=self.arc(self.point(ci,True),self.point(cj,False))
        h=self.pidx['HOTEL']
        self.from_hotel={j:self.arc(h,self.point(cj,False)) for j,cj in enumerate(self.cands)}
        self.to_hotel={i:self.arc(self.point(ci,True),h) for i,ci in enumerate(self.cands)}
        self.must_idx=[i for i,c in enumerate(self.cands) if c['id'] in self.must]
    def edge_count(self): return sum(1 for v in self.arcs.values() if v)
# ---- independent checker -------------------------------------------------
def check(P,plan):
    arcs=plan.get('arcfn') or (lambda i,j:P.arcs[(i,j)])
    """plan: {'days':[[{'i':idx,'start':min}],...]} -> list of violations (empty = valid)"""
    v=[]; seen=set()
    for d,items in enumerate(plan['days']):
        date=P.dates[d]; wd=weekday(date); walk=0; prev=None
        if P.start_anchor and items:
            a=P.from_hotel[items[0]['i']]
            if a is None: v.append(f'd{d} no mode hotel->first')
            elif items[0]['start']<P.window[0]+a['minutes']-1e-6: v.append(f'd{d} first start before hotel travel')
            else: walk+=a['walk_min']
        for it in items:
            i=it['i']; c=P.cands[i]; s=it['start']
            if i in seen: v.append(f'dup {c["id"]}')
            seen.add(i)
            tl,total=P.timeline(c)
            if s<P.window[0]-1e-6 or s+total>P.window[1]+1e-6: v.append(f'd{d} {c["id"]} outside day window')
            for off,dur,k in tl:
                h=k['hours']
                if h['status']=='KNOWN':
                    a,b=s+off,s+off+dur
                    if not any(o-1e-6<=a and b<=cl+1e-6 for o,cl in h['weekly'][wd]): v.append(f'd{d} {c["id"]} opening-hours violation {a:.0f}-{b:.0f}')
            if prev is not None:
                arc=arcs(prev['i'],i)
                if arc is None: v.append(f'd{d} no allowed mode {prev["i"]}->{i}')
                else:
                    if s<prev['start']+P.service[prev['i']]+arc['minutes']-1e-6: v.append(f'd{d} travel-time violation {P.cands[prev["i"]]["id"]}->{c["id"]}')
                    if arc['mode'] not in P.modes: v.append('mode not allowed')
                    if arc['mode']=='walk' and arc['minutes']>P.limits['max_continuous_walk_min']+1e-6: v.append('continuous walking exceeded')
                    walk+=arc['walk_min']
            prev=it
        if P.end_anchor and items:
            a=P.to_hotel[items[-1]['i']]
            if a is None: v.append(f'd{d} no mode last->hotel')
            elif items[-1]['start']+P.service[items[-1]['i']]+a['minutes']>P.window[1]+1e-6: v.append(f'd{d} end-anchor travel exceeds window')
            else: walk+=a['walk_min']
        if walk>P.limits['daily_walk_budget_min']+1e-6: v.append(f'd{d} daily walking budget exceeded ({walk:.0f})')
    for m in P.must_idx:
        if m not in seen: v.append(f'mustInclude missing {P.cands[m]["id"]}')
    return v
def hav(a,b):
    R=6371000;la1,lo1,la2,lo2=map(math.radians,(a[0],a[1],b[0],b[1]))
    return 2*R*math.asin(math.sqrt(math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2))
def metrics(P,plan):
    arcs=plan.get('arcfn') or (lambda i,j:P.arcs[(i,j)])
    m={'scheduled':0,'desirability':0.0,'visit_min':0.0,'travel_min':0.0,'walk_min':0.0,'drive_legs':0,'walk_legs':0,'idle_min':0.0,'unknown_hours_scheduled':0,
       'objective_test_weights':0.0,'day_spread_m':[],'residual_min':[]}
    sel=set()
    for d,items in enumerate(plan['days']):
        used=0.0; pts=[]
        legs=[]
        if P.start_anchor and items: legs.append(P.from_hotel[items[0]['i']])
        for k,it in enumerate(items):
            i=it['i']; sel.add(i); m['scheduled']+=1; m['desirability']+=P.cands[i]['desirability']; m['visit_min']+=P.service[i]; m['unknown_hours_scheduled']+=P.unc[i]
            m['objective_test_weights']+=P.value[i]-P.weights['opening_hours_uncertainty_penalty']*P.unc[i]
            c=P.cands[i]; k0=P.visit_components(c)[0]; pts.append((k0['lat'],k0['lon']))
            if k>0:
                a=arcs(items[k-1]['i'],i); legs.append(a)
                m['idle_min']+=max(0,it['start']-(items[k-1]['start']+P.service[items[k-1]['i']]+a['minutes']))
        if P.end_anchor and items: legs.append(P.to_hotel[items[-1]['i']])
        for a in legs:
            if not a: continue
            m['travel_min']+=a['minutes']; m['walk_min']+=a['walk_min']; m['objective_test_weights']-=a['cost']
            m['drive_legs' if a['mode']=='drive' else 'walk_legs']+=1
        if items:
            span=(items[-1]['start']+P.service[items[-1]['i']])-items[0]['start']
            cen=(sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts))
            m['day_spread_m'].append(round(sum(hav(p,cen) for p in pts)/len(pts)))
            m['residual_min'].append(round((P.window[1]-P.window[0])-span))
        else: m['residual_min'].append(P.window[1]-P.window[0]); m['day_spread_m'].append(0)
    unsched=[i for i in range(P.n) if i not in sel]
    m['omitted_top']=[P.cands[i]['title'] for i in unsched if P.cands[i]['desirability']>=min((P.cands[j]['desirability'] for j in sel),default=0)]
    m['desirability']=round(m['desirability'],3)
    for k in ('visit_min','travel_min','walk_min','idle_min','objective_test_weights'): m[k]=round(m[k],1)
    # readiness classification (design C2) from planner output only
    meaningful=[r for r in m['residual_min'] if r>=MIN_USEFUL_RESIDUAL_MIN]
    unused_supply=sum(P.service[i] for i in unsched)
    if m['scheduled']==0: m['readiness']='PLANNER_INFEASIBLE' if P.n>0 else 'INSUFFICIENT_KNOWLEDGE'
    elif not meaningful: m['readiness']='READY'
    elif unused_supply>=sum(meaningful): m['readiness']='PLANNER_LIMITED'
    else: m['readiness']='CANDIDATE_SUPPLY_LIMITED (would request acquisition)'
    return m
