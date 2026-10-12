"""Record provider-backed travel (Geoapify Route Matrix walk/drive; Routing for the composite internal leg).
Recorded once; solvers replay these files. Key from env, never stored."""
import json, os, time, urllib.request
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
KEY=os.environ['GEOAPIFY_API_KEY']
def points(fx):
    pts=[]
    for x in fx['candidates']:
        if x['kind']=='SINGLE':
            c=x['components'][0]; pts.append({'pid':x['id'],'lat':c['lat'],'lon':c['lon']})
        else:
            t=[c for c in x['components'] if c['participation']=='TRAVERSE'][0]; v=[c for c in x['components'] if c['participation']=='VISIT'][-1]
            pts.append({'pid':x['id']+'#start','lat':t['from']['lat'],'lon':t['from']['lon']})
            pts.append({'pid':x['id']+'#end','lat':v['lat'],'lon':v['lon']})
    pts.append({'pid':'HOTEL','lat':fx['hotel']['lat'],'lon':fx['hotel']['lon']})
    return pts
def post(url,body):
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    t=time.perf_counter()
    with urllib.request.urlopen(req,timeout=180) as r: out=json.load(r)
    return out,round((time.perf_counter()-t)*1000)
for city in ('BA','PA','LA'):
    fx=json.load(open(os.path.join(ROOT,'fixtures',f'{city}.json'))); pts=points(fx)
    assert len(pts)*len(pts)<=1000, (city,len(pts))
    for mode in ('walk','drive'):
        path=os.path.join(ROOT,'fixtures',f'{city}_matrix_{mode}.json')
        if os.path.exists(path): continue
        locs=[{'location':[p['lon'],p['lat']]} for p in pts]
        out,ms=post('https://api.geoapify.com/v1/routematrix?apiKey='+KEY,{'mode':mode,'sources':locs,'targets':locs})
        rows=out['sources_to_targets']
        M={'provider':'geoapify','api':'routematrix','mode':mode,'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'latency_ms':ms,
           'points':pts,'time_s':[[c.get('time') for c in row] for row in rows],'distance_m':[[c.get('distance') for c in row] for row in rows]}
        json.dump(M,open(path,'w')); print(city,mode,len(pts),'points',ms,'ms nulls',sum(1 for r in M['time_s'] for v in r if v is None)); time.sleep(1)
# composite internal leg: end of Defensa traversal -> Mercado (walk)
fx=json.load(open(os.path.join(ROOT,'fixtures','BA.json'))); comp=[x for x in fx['candidates'] if x['kind']=='COMPOSITE'][0]
t=[c for c in comp['components'] if c['participation']=='TRAVERSE'][0]; v=[c for c in comp['components'] if c['participation']=='VISIT'][0]
path=os.path.join(ROOT,'fixtures','BA_composite_internal_leg.json')
if not os.path.exists(path):
    url=f"https://api.geoapify.com/v1/routing?waypoints={t['to']['lat']},{t['to']['lon']}|{v['lat']},{v['lon']}&mode=walk&apiKey={KEY}"
    with urllib.request.urlopen(url,timeout=60) as r: o=json.load(r)
    p=o['features'][0]['properties']
    json.dump({'provider':'geoapify','api':'routing','mode':'walk','from':t['to'],'to':{'lat':v['lat'],'lon':v['lon']},'time_s':p['time'],'distance_m':p['distance'],'retrieved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},open(path,'w'))
    print('internal leg',p['time'],'s',p['distance'],'m')
