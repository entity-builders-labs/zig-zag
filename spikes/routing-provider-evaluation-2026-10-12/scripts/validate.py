import json, math, sys
def to_xy(lon,lat,lat0):
    return (math.radians(lon)*6371000*math.cos(math.radians(lat0)), math.radians(lat)*6371000)
def densify(pts, step=2.0):
    out=[]
    for (x1,y1),(x2,y2) in zip(pts,pts[1:]):
        L=math.hypot(x2-x1,y2-y1); n=max(1,int(L/step))
        for i in range(n): out.append((x1+(x2-x1)*i/n, y1+(y2-y1)*i/n))
    out.append(pts[-1]); return out
def seg_dist(p,a,b):
    (px,py),(ax,ay),(bx,by)=p,a,b; dx,dy=bx-ax,by-ay; L2=dx*dx+dy*dy
    t=0 if L2==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L2))
    return math.hypot(px-ax-t*dx, py-ay-t*dy), t
def dist_to_line(p,line):
    best=(1e18,0,0); acc=0
    for i,(a,b) in enumerate(zip(line,line[1:])):
        d,t=seg_dist(p,a,b); L=math.hypot(b[0]-a[0],b[1]-a[1])
        if d<best[0]: best=(d,acc+t*L,i)
        acc+=L
    return best
def lines(geom):
    if geom['type']=='LineString': return [geom['coordinates']]
    return geom['coordinates']
src=json.load(open(sys.argv[1]))['geometry']['coordinates']
outg=json.load(open(sys.argv[2])); g=outg['features'][0]['geometry'] if 'features' in outg else outg['geometry']
out=[c for part in lines(g) for c in part]
lat0=src[0][1]; S=[to_xy(*c,lat0) for c in src]; O=[to_xy(c[0],c[1],lat0) for c in out]
Sd=densify(S); Od=densify(O)
src_len=sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(S,S[1:]))
out_len=sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(O,O[1:]))
s2o=[dist_to_line(p,O)[0] for p in Sd]          # source covered by output
o2s=[dist_to_line(p,S) for p in Od]              # output off the source
res={}
for tol in (2,5,10,15):
    res[f'coverage@{tol}m']=round(sum(d<=tol for d in s2o)/len(s2o),3)
    res[f'output_on_source@{tol}m']=round(sum(d[0]<=tol for d in o2s)/len(o2s),3)
res['hausdorff_m']=round(max(max(s2o),max(d[0] for d in o2s)),1)
# ordered progression: along-source position of output points must be non-decreasing (within tolerance)
pos=[d[1] for d in o2s if d[0]<=15]
back=sum(max(0,pos[i-1]-pos[i]) for i in range(1,len(pos)))
res['backtrack_m']=round(back,1); res['src_len_m']=round(src_len,1); res['out_len_m']=round(out_len,1)
print(json.dumps(res))
