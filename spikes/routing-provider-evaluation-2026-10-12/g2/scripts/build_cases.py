"""Build required segments and structural alternatives from OSM (Overpass).
Required = chain of ways named <street> between two intersection nodes with other
named roads. Alternatives (labels fixed by construction):
  PARALLEL  - chain of the nearest other street that meets both cross streets
  DETOUR    - A -> cross street A -> parallel street -> cross street B -> B
  PARTIAL   - required chain cut at its middle intersection (first part only)
  REVERSED  - required chain in reverse order
No coordinate is invented: every vertex is an OSM node."""
import json, sys, time, math, urllib.request, urllib.parse, collections, os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
ENDPOINT={'BA':'http://localhost:12345/api/interpreter','PA':'https://maps.mail.ru/osm/tools/overpass/api/interpreter','LA':'https://maps.mail.ru/osm/tools/overpass/api/interpreter'}
ROADS='^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|path|cycleway|steps|service|primary_link|secondary_link|tertiary_link)$'
CROSS_OK={'trunk','primary','secondary','tertiary','unclassified','residential','living_street','pedestrian','primary_link','secondary_link','tertiary_link'}
def overpass(city, q, cache):
    path=os.path.join(ROOT,'osm',cache)
    if os.path.exists(path): return json.load(open(path))
    data=urllib.parse.urlencode({'data':q}).encode()
    for attempt in range(4):
        try:
            req=urllib.request.Request(ENDPOINT[city],data=data,headers={'User-Agent':'zig-zag-g2-calibration/1.0 (research; bounded)'})
            with urllib.request.urlopen(req,timeout=180) as r: out=json.load(r)
            json.dump(out,open(path,'w')); time.sleep(0 if city=='BA' else 3); return out
        except Exception as e:
            print('overpass retry',city,cache,e,file=sys.stderr); time.sleep(10*(attempt+1))
    raise RuntimeError('overpass failed '+cache)
def hav(a,b):
    R=6371000;la1,lo1,la2,lo2=map(math.radians,(a[0],a[1],b[0],b[1]))
    return 2*R*math.asin(math.sqrt(math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2))
def bb(b,pad): return f"{b[0]-pad},{b[1]-pad},{b[2]+pad},{b[3]+pad}"
def ingest(d,ways,nodes):
    for e in d['elements']:
        if e['type']=='way':
            ways[e['id']]=e
            for nid,g in zip(e['nodes'],e.get('geometry',[])): nodes[nid]=(g['lat'],g['lon'])
def bfs(a,b,ways,allowed):
    adj=collections.defaultdict(set)
    for w in ways.values():
        if w['id'] not in allowed: continue
        for x,y in zip(w['nodes'],w['nodes'][1:]): adj[x].add((y,w['id'])); adj[y].add((x,w['id']))
    # Dijkstra by length is unnecessary inside one street; BFS on hops suffices but use length for safety
    import heapq
    dist={a:0};prev={};pq=[(0,a)]
    return adj,dist,prev,pq
def shortest(a,b,ways,allowed,nodes):
    import heapq
    adj=collections.defaultdict(set)
    for w in ways.values():
        if w['id'] not in allowed: continue
        for x,y in zip(w['nodes'],w['nodes'][1:]): adj[x].add((y,w['id'])); adj[y].add((x,w['id']))
    dist={a:0};prev={};pq=[(0,a)]
    while pq:
        d,u=heapq.heappop(pq)
        if u==b: break
        if d>dist.get(u,1e18): continue
        for v,wid in adj[u]:
            nd=d+hav(nodes[u],nodes[v])
            if nd<dist.get(v,1e18): dist[v]=nd; prev[v]=(u,wid); heapq.heappush(pq,(nd,v))
    if b not in dist: return None
    path=[b];wids=[]
    while path[-1]!=a: u,wid=prev[path[-1]]; path.append(u); wids.append(wid)
    path.reverse(); wids=list(dict.fromkeys(reversed(wids)))
    return {'nodes':path,'ways':wids,'length_m':round(dist[b],1)}
def feature(path,nodes,props):
    return {'type':'Feature','properties':props,'geometry':{'type':'LineString','coordinates':[[nodes[n][1],nodes[n][0]] for n in path['nodes']]}}
def build(case):
    cid,city,street,box=case['id'],case['city'],case['street'],case['bbox']
    q1=f'[out:json][timeout:120];way["highway"]["name"="{street}"]({bb(box,0)})->.r;node(w.r)->.rn;(.r;way(bn.rn)["highway"~"{ROADS}"]["name"];);out body geom;'
    d1=overpass(city,q1,f'{cid}_q1.json'); ways={};nodes={}; ingest(d1,ways,nodes)
    req_ids={w['id'] for w in ways.values() if w['tags'].get('name')==street}
    req_nodes={n for wid in req_ids for n in ways[wid]['nodes']}
    inter={}  # node -> cross street name
    for w in ways.values():
        nm=w['tags'].get('name'); hw=w['tags'].get('highway')
        if w['id'] in req_ids or nm==street or hw not in CROSS_OK or w['tags'].get('footway'): continue
        for n in w['nodes']:
            if n in req_nodes: inter.setdefault(n,nm)
    cands=[]
    ilist=sorted(inter)
    for i,a in enumerate(ilist):
        for b in ilist[i+1:]:
            if inter[a]==inter[b]: continue
            p=shortest(a,b,ways,req_ids,nodes)
            if not p: continue
            mids=[n for n in p['nodes'][1:-1] if n in inter]
            cands.append((p,a,b,len(set(inter[m] for m in mids))))
    if case.get('force'):
        a,b=case['force']; p=shortest(a,b,ways,req_ids,nodes)
        if not p: return {'id':cid,'error':'forced segment not connected'}
    else:
        if not cands: return {'id':cid,'error':'no segment'}
        within=[c for c in cands if 120<=c[0]['length_m']<=900] or cands
        p,a,b,nm=max(within,key=lambda c:(c[3],-abs(c[0]['length_m']-550)))
    if hav(nodes[p['nodes'][0]],nodes[a])>1: p['nodes'].reverse()
    cA,cB=inter[a],inter[b]
    out={'id':cid,'city':city,'street':street,'kind':case['kind'],'from':{'node':a,'cross':cA},'to':{'node':b,'cross':cB},
         'required':feature(p,nodes,{'role':'REQUIRED','osm_way_ids':p['ways'],'osm_node_ids':p['nodes'],'length_m':p['length_m']}),'alternatives':{}}
    rev=dict(p); rev={'nodes':list(reversed(p['nodes'])),'ways':p['ways'],'length_m':p['length_m']}
    out['alternatives']['REVERSED']=feature(rev,nodes,{'role':'REVERSED','construction':'required node order reversed'})
    mids=[i for i,n in enumerate(p['nodes'][1:-1],1) if n in inter]
    cut=mids[len(mids)//2] if mids else len(p['nodes'])//2
    if cut>=1:
        part={'nodes':p['nodes'][:cut+1],'ways':p['ways'],'length_m':round(sum(hav(nodes[x],nodes[y]) for x,y in zip(p['nodes'][:cut],p['nodes'][1:cut+1])),1)}
        out['alternatives']['PARTIAL']=feature(part,nodes,{'role':'PARTIAL','construction':f'required chain cut at node index {cut}','length_m':part['length_m']})
    # parallel street: meets cross street A and cross street B near A and B
    q2=f'[out:json][timeout:120];way["highway"]["name"~"^({cA}|{cB})$"]({bb(box,0.006)})->.c;node(w.c)->.cn;(.c;way(bn.cn)["highway"~"{ROADS}"]["name"];);out body geom;'
    d2=overpass(city,q2,f'{cid}_q2.json'); ingest(d2,ways,nodes)
    cAw={w['id'] for w in ways.values() if w['tags'].get('name')==cA}; cBw={w['id'] for w in ways.values() if w['tags'].get('name')==cB}
    cAn={n for i in cAw for n in ways[i]['nodes']}; cBn={n for i in cBw for n in ways[i]['nodes']}
    cands={}
    for w in ways.values():
        nm=w['tags'].get('name')
        if nm in (street,cA,cB) or w['tags'].get('highway') not in CROSS_OK or w['tags'].get('footway'): continue
        for n in w['nodes']:
            if n not in cAn: continue
            da=hav(nodes[n],nodes[a])
            if not 20<da<=400: continue
            for w2 in ways.values():
                if w2['tags'].get('name')!=nm: continue
                for m in w2['nodes']:
                    if m in cBn:
                        db=hav(nodes[m],nodes[b])
                        if 20<db<=400 and (nm not in cands or da+db<cands[nm][0]): cands[nm]=(da+db,n,m)
    for P,(score,a2,b2) in sorted(cands.items(),key=lambda kv:kv[1][0]):
        safe=''.join(ch if ch.isalnum() else '_' for ch in P)
        q3=f'[out:json][timeout:120];way["highway"]["name"="{P}"]({bb(box,0.008)});out body geom;'
        d3=overpass(city,q3,f'{cid}_q3_{safe}.json'); ingest(d3,ways,nodes)
        Pw={w['id'] for w in ways.values() if w['tags'].get('name')==P}
        par=shortest(a2,b2,ways,Pw,nodes)
        if not par: continue
        out['alternatives']['PARALLEL']=feature(par,nodes,{'role':'PARALLEL','street':P,'osm_way_ids':par['ways'],'length_m':par['length_m']})
        legA=shortest(a,a2,ways,cAw,nodes); legB=shortest(b2,b,ways,cBw,nodes)
        if legA and legB:
            det={'nodes':legA['nodes']+par['nodes'][1:]+legB['nodes'][1:],'ways':legA['ways']+par['ways']+legB['ways'],'length_m':round(legA['length_m']+par['length_m']+legB['length_m'],1)}
            out['alternatives']['DETOUR']=feature(det,nodes,{'role':'DETOUR','via':[cA,P,cB],'length_m':det['length_m']})
        break
    return out
if __name__=='__main__':
    cases=json.load(open(os.path.join(HERE,'cases.json'))); res=[]
    for c in cases:
        try: r=build(c)
        except Exception as e: r={'id':c['id'],'error':str(e)}
        res.append(r)
        print(r['id'], r.get('error') or f"{r['street']} {r['from']['cross']} -> {r['to']['cross']} {r['required']['properties']['length_m']}m alts={list(r['alternatives'])} par={r['alternatives'].get('PARALLEL',{}).get('properties',{}).get('street')}")
    json.dump(res,open(os.path.join(ROOT,'segments.json'),'w'),indent=1)
