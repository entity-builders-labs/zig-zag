"""G2 runner: provider outputs + raw metrics + threshold-free label confirmation.
Raw metrics are continuous; NO acceptance tolerance is applied here."""
import json, os, sys, math, time, urllib.request, urllib.parse
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
KEY=os.environ.get('GEOAPIFY_API_KEY'); VALHALLA=os.environ.get('VALHALLA_URL','http://localhost:8102')
OUT=os.path.join(ROOT,'outputs')
# ---------- geometry (adapter normalization: everything becomes [lon,lat] LineString)
def to_xy(lon,lat,lat0): return (math.radians(lon)*6371000*math.cos(math.radians(lat0)), math.radians(lat)*6371000)
def densify(P,step=1.0):
    out=[]
    for (x1,y1),(x2,y2) in zip(P,P[1:]):
        L=math.hypot(x2-x1,y2-y1); n=max(1,int(L/step))
        out+= [(x1+(x2-x1)*i/n, y1+(y2-y1)*i/n) for i in range(n)]
    return out+[P[-1]]
def proj(p,line):
    best=(1e18,0.0); acc=0.0
    for a,b in zip(line,line[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1]; L2=dx*dx+dy*dy; L=math.sqrt(L2)
        t=0 if L2==0 else max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2))
        d=math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
        if d<best[0]: best=(d,acc+t*L)
        acc+=L
    return best
def length(P): return sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(P,P[1:]))
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*(len(v)-1)+0.5))]
def metrics(req_ll,out_ll,unmatched=None):
    lat0=req_ll[0][1]; R=[to_xy(*c,lat0) for c in req_ll]; O=[to_xy(*c,lat0) for c in out_ll]
    if len(O)<2 or length(O)<1: return {'empty_output':True,'req_len_m':round(length(R),1),'out_len_m':0.0}
    Rd=densify(R); Od=densify(O)
    r2o=[proj(p,O)[0] for p in Rd]; o2r=[proj(p,R) for p in Od]
    pos=[x[1] for x in o2r]
    back=sum(max(0,pos[i-1]-pos[i]) for i in range(1,len(pos)))
    Lr=length(R)
    return {'empty_output':False,'req_len_m':round(Lr,1),'out_len_m':round(length(O),1),
      'req_to_out_max_m':round(max(r2o),2),'req_to_out_p95_m':round(pct(r2o,0.95),2),
      'out_to_req_max_m':round(max(d for d,_ in o2r),2),'out_to_req_p95_m':round(pct([d for d,_ in o2r],0.95),2),
      'hausdorff_m':round(max(max(r2o),max(d for d,_ in o2r)),2),
      'start_pos_m':round(pos[0],1),'end_pos_m':round(pos[-1],1),'forward_progress_m':round(pos[-1]-pos[0],1),
      'backtrack_m':round(back,1),'backtrack_ratio':round(back/Lr,4),
      'unmatched_points':unmatched}
def hausdorff(a_ll,b_ll):
    lat0=a_ll[0][1]; A=densify([to_xy(*c,lat0) for c in a_ll]); B=densify([to_xy(*c,lat0) for c in b_ll])
    if len(B)<2: return 1e9
    return max(max(proj(p,B)[0] for p in A), max(proj(p,A)[0] for p in B))
def d(a,b,lat0): pa,pb=to_xy(*a,lat0),to_xy(*b,lat0); return math.hypot(pa[0]-pb[0],pa[1]-pb[1])
# ---------- providers (adapters normalize to [lon,lat] list + unmatched count)
def http(url,body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(url,data=data,headers={'Content-Type':'application/json'})
    t=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=120) as r: out=json.load(r)
    except urllib.error.HTTPError as e: out={'http_error':e.code,'body':e.read().decode()[:300]}
    return out,round((time.perf_counter()-t)*1000)
def geo_mm(coords,mode='walk'):
    out,ms=http('https://api.geoapify.com/v1/mapmatching?apiKey='+KEY,{'mode':mode,'waypoints':[{'location':c} for c in coords]}); time.sleep(0.3)
    if 'features' not in out or not out['features']: return None,None,ms,out
    f=out['features'][0]; g=f['geometry']; parts=g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
    ll=[c for part in parts for c in part]
    um=sum(1 for w in f['properties'].get('waypoints',[]) if w.get('match_type')=='unmatched')
    return ll,um,ms,{'distance':f['properties'].get('distance'),'time':f['properties'].get('time')}
def geo_route(a,b,mode):
    url=f"https://api.geoapify.com/v1/routing?waypoints={a[1]},{a[0]}|{b[1]},{b[0]}&mode={mode}&apiKey={KEY}"
    out,ms=http(url); time.sleep(0.3)
    if 'features' not in out or not out['features']: return None,None,ms,out
    f=out['features'][0]; g=f['geometry']; parts=g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
    return [c for p in parts for c in p],0,ms,{'distance':f['properties'].get('distance'),'time':f['properties'].get('time')}
def decode6(s):
    coords=[];lat=lon=0;i=0
    while i<len(s):
        vals=[]
        for _ in (0,1):
            shift=res=0
            while True:
                b=ord(s[i])-63;i+=1;res|=(b&0x1f)<<shift;shift+=5
                if b<0x20: break
            vals.append(~(res>>1) if res&1 else res>>1)
        lat+=vals[0];lon+=vals[1];coords.append([lon/1e6,lat/1e6])
    return coords
def val_trace(coords):
    shape=[{'lat':c[1],'lon':c[0]} for c in coords]
    out,ms=http(VALHALLA+'/trace_route',{'shape':shape,'costing':'pedestrian','shape_match':'map_snap'})
    if 'trip' not in out: return None,None,ms,out
    ll=[c for leg in out['trip']['legs'] for c in decode6(leg['shape'])]
    att,_=http(VALHALLA+'/trace_attributes',{'shape':shape,'costing':'pedestrian','shape_match':'map_snap','filters':{'attributes':['matched.type'],'action':'include'}})
    um=sum(1 for p in att.get('matched_points',[]) if p.get('type')=='unmatched')
    return ll,um,ms,{'length_km':out['trip']['summary']['length'],'time':out['trip']['summary']['time']}
def val_route(a,b):
    out,ms=http(VALHALLA+'/route',{'locations':[{'lat':a[1],'lon':a[0]},{'lat':b[1],'lon':b[0]}],'costing':'pedestrian'})
    if 'trip' not in out: return None,None,ms,out
    return [c for leg in out['trip']['legs'] for c in decode6(leg['shape'])],0,ms,{'length_km':out['trip']['summary']['length'],'time':out['trip']['summary']['time']}
# ---------- label confirmation (threshold-free: nearest structural reference)
def confirm(expected,kind,out_ll,req,alts):
    lat0=req[0][1]
    if expected=='VALID':
        hr=hausdorff(out_ll,req); others={k:hausdorff(out_ll,v) for k,v in alts.items() if k in('PARALLEL','DETOUR','PARTIAL')}
        fwd=d(out_ll[0],req[0],lat0)<d(out_ll[0],req[-1],lat0)
        ok=fwd and all(hr<v for v in others.values())
        return ('VALID' if ok else 'AMBIGUOUS'),{'h_required':round(hr,1),**{f'h_{k.lower()}':round(v,1) for k,v in others.items()},'forward':fwd}
    if kind=='REVERSED':
        rev=d(out_ll[0],req[-1],lat0)<d(out_ll[0],req[0],lat0)
        return ('CONSTRAINT_UNSATISFIED' if rev else 'AMBIGUOUS'),{'starts_at_required_end':rev}
    if kind in ('PARALLEL','DETOUR','PARTIAL'):
        ha=hausdorff(out_ll,alts[kind]); hr=hausdorff(out_ll,req)
        return ('CONSTRAINT_UNSATISFIED' if ha<hr else 'AMBIGUOUS'),{'h_alt':round(ha,1),'h_required':round(hr,1)}
    if kind=='ENDPOINT':
        hr=hausdorff(out_ll,req); others={k:hausdorff(out_ll,v) for k,v in alts.items() if k in('PARALLEL','DETOUR')}
        if not others: return 'AMBIGUOUS',{'h_required':round(hr,1),'reason':'no structural alternative to compare'}
        closer_alt=min(others.values())<hr
        return ('CONSTRAINT_UNSATISFIED' if closer_alt else 'VALID'),{'h_required':round(hr,1),**{f'h_{k.lower()}':round(v,1) for k,v in others.items()}}
    return 'AMBIGUOUS',{}
def run():
    segs=[s for s in json.load(open(os.path.join(ROOT,'segments.json'))) if 'required' in s]
    rows=[]
    for s in segs:
        req=s['required']['geometry']['coordinates']; alts={k:v['geometry']['coordinates'] for k,v in s['alternatives'].items()}
        def add(source,provider,api,mode,kind,expected,out_ll,um,ms,meta,confirm_label=True):
            m=metrics(req,out_ll,um) if out_ll else {'provider_error':meta}
            lab,ev=confirm(expected,kind,out_ll,req,alts) if (out_ll and confirm_label) else ((expected if out_ll else 'EXCLUDED'),{'by':'construction'} if out_ll else {'reason':'provider returned no geometry'})
            row={'case':s['id'],'city':s['city'],'street':s['street'],'output_id':f"{s['id']}:{source}:{kind}:{mode}",'source':source,'provider':provider,'api':api,'mode':mode,
                 'kind':kind,'expected':expected,'label':lab,'label_evidence':ev,'latency_ms':ms,'provider_meta':meta,**m}
            rows.append(row); json.dump(out_ll,open(os.path.join(OUT,row['output_id'].replace(':','__').replace('/','-')+'.json'),'w'))
        # structural alternatives as outputs (label certain by construction)
        for k,g in alts.items(): add('osm','structural','osm-geometry','n/a',k,'CONSTRAINT_UNSATISFIED',g,None,0,{},confirm_label=False)
        # Geoapify map matching: required (positive) and alternatives (negatives)
        ll,um,ms,meta=geo_mm(req); add('geoapify','geoapify','mapmatching','walk','REQUIRED','VALID',ll,um,ms,meta)
        for k,g in alts.items():
            ll,um,ms,meta=geo_mm(g); add('geoapify','geoapify','mapmatching','walk',k,'CONSTRAINT_UNSATISFIED',ll,um,ms,meta)
        for mode in ('walk','drive'):
            ll,um,ms,meta=geo_route(req[0],req[-1],mode); add('geoapify','geoapify','routing',mode,'ENDPOINT','?',ll,um,ms,meta)
        if s['city']=='BA':
            ll,um,ms,meta=val_trace(req); add('valhalla','valhalla-3.9.1','trace_route','pedestrian','REQUIRED','VALID',ll,um,ms,meta)
            for k,g in alts.items():
                ll,um,ms,meta=val_trace(g); add('valhalla','valhalla-3.9.1','trace_route','pedestrian',k,'CONSTRAINT_UNSATISFIED',ll,um,ms,meta)
            ll,um,ms,meta=val_route(req[0],req[-1]); add('valhalla','valhalla-3.9.1','route','pedestrian','ENDPOINT','?',ll,um,ms,meta)
        print(s['id'],len(rows),file=sys.stderr)
    json.dump(rows,open(os.path.join(ROOT,'raw_metrics.json'),'w'),indent=1)
if __name__=='__main__': run()
