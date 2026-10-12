import json, sys, math
d=json.load(open(sys.argv[1])); A=int(sys.argv[2]); B=int(sys.argv[3])
nodes={e['id']:(e['lat'],e['lon']) for e in d['elements'] if e['type']=='node'}
ways=[e for e in d['elements'] if e['type']=='way']
adj={}
for w in ways:
    ns=w['nodes']
    for a,b in zip(ns,ns[1:]):
        adj.setdefault(a,set()).add((b,w['id'])); adj.setdefault(b,set()).add((a,w['id']))
# BFS shortest path in node graph restricted to Defensa ways
from collections import deque
prev={A:None}; q=deque([A])
while q:
    u=q.popleft()
    if u==B: break
    for v,wid in adj.get(u,()):
        if v not in prev: prev[v]=(u,wid); q.append(v)
path=[];u=B;wids=[]
while u is not None:
    path.append(u); p=prev[u]
    if p: wids.append(p[1]); u=p[0]
    else: u=None
path.reverse(); wids=list(dict.fromkeys(reversed(wids)))
def hav(a,b):
    R=6371000;la1,lo1=map(math.radians,a);la2,lo2=map(math.radians,b)
    h=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))
L=sum(hav(nodes[a],nodes[b]) for a,b in zip(path,path[1:]))
out={"type":"Feature","properties":{"source":"osm via local overpass (ui-redesign_overpass_argentina_data)","from_node":A,"to_node":B,"osm_way_ids":wids,"osm_node_ids":path,"length_m_haversine":round(L,1)},
     "geometry":{"type":"LineString","coordinates":[[nodes[n][1],nodes[n][0]] for n in path]}}
json.dump(out,open(sys.argv[4],'w'),indent=1)
print(len(path),'nodes',round(L,1),'m ways',wids)
