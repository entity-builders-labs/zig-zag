"""Threshold-free ground truth from OSM way identity (independent of the validator).
An output is GT_VALID iff
  (1) every densified output point's nearest street-centerline way is a required way,
      except points inside an endpoint junction (nearer to the endpoint node than half
      of the adjacent required edge - a bound taken from the geometry itself);
  (2) every required OSM node owns (is the nearest required node of) at least one
      on-required output point;
  (3) the first-ownership order of required nodes is non-decreasing.
Centerlines exclude footway=sidewalk/crossing so sidewalk-matched outputs map to their street.
Junction neighbourhoods (every required node shared with another way, plus both ends)
absorb sub-metre matching noise at intersections; their radius is half the shorter
adjacent required edge."""
import json, os, sys, math, urllib.request, urllib.parse, time
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
sys.path.insert(0,HERE); from build_cases import ENDPOINT
from run_eval import to_xy, densify
def seg_d(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]; L2=dx*dx+dy*dy
    t=0 if L2==0 else max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2))
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
def fetch(city,cid,bbox):
    path=os.path.join(ROOT,'osm',f'{cid}_gt.json')
    if os.path.exists(path): return json.load(open(path))
    q=f'[out:json][timeout:180];way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});out body geom;'
    for i in range(5):
        try:
            req=urllib.request.Request(ENDPOINT[city],data=urllib.parse.urlencode({'data':q}).encode(),headers={'User-Agent':'zig-zag-g2-calibration/1.0'})
            with urllib.request.urlopen(req,timeout=240) as r: d=json.load(r)
            json.dump(d,open(path,'w')); time.sleep(0 if city=='BA' else 3); return d
        except Exception as e: print('retry',cid,e,file=sys.stderr); time.sleep(15*(i+1))
    raise RuntimeError('gt fetch failed '+cid)
def main():
    segs={s['id']:s for s in json.load(open(os.path.join(ROOT,'segments.json'))) if 'required' in s}
    rows=json.load(open(os.path.join(ROOT,'raw_metrics.json')))
    outdir=os.path.join(ROOT,'outputs')
    for cid,s in segs.items():
        req=s['required']['geometry']['coordinates']; req_ways=set(s['required']['properties']['osm_way_ids'])
        mine=[r for r in rows if r['case']==cid]
        outs={r['output_id']:json.load(open(os.path.join(outdir,r['output_id'].replace(':','__').replace('/','-')+'.json'))) for r in mine}
        pts=[c for o in outs.values() if o for c in o]+req
        lats=[c[1] for c in pts]; lons=[c[0] for c in pts]
        bbox=(min(lats)-0.002,min(lons)-0.002,max(lats)+0.002,max(lons)+0.002)
        d=fetch(s['city'],cid,bbox)
        lat0=req[0][1]
        ways=[]
        for e in d['elements']:
            if e['type']!='way': continue
            t=e['tags']
            if t.get('footway') in ('sidewalk','crossing') or t.get('highway') in ('platform','corridor','elevator','proposed','construction'): continue
            geo=[to_xy(g['lon'],g['lat'],lat0) for g in e.get('geometry',[])]
            if len(geo)>=2: ways.append((e['id'],geo))
        R=[to_xy(c[0],c[1],lat0) for c in req]
        req_nodes=s['required']['properties']['osm_node_ids']
        node_ways={}
        for e in d['elements']:
            if e['type']=='way':
                for nid in e.get('nodes',[]): node_ways.setdefault(nid,set()).add(e['id'])
        # junction neighbourhood radius per required node: half of the shorter adjacent required edge
        # (endpoints always count as junctions); taken from the geometry itself, not a tolerance
        def half_edge(i):
            es=[math.hypot(R[j][0]-R[i][0],R[j][1]-R[i][1]) for j in (i-1,i+1) if 0<=j<len(R)]
            return min(es)/2
        junction={i:half_edge(i) for i,nid in enumerate(req_nodes) if i in (0,len(R)-1) or len(node_ways.get(nid,set())-req_ways)>0}
        present={w for w,_ in ways}
        for r in mine:
            o=outs[r['output_id']]
            if not o or len(o)<2: r['gt']='EXCLUDED'; r['gt_evidence']={'reason':'no output'}; continue
            if not req_ways<=present: r['gt']='EXCLUDED'; r['gt_evidence']={'reason':'required ways missing from GT extract'}; continue
            O=densify([to_xy(c[0],c[1],lat0) for c in o],2.0)
            off=0; owners=[]; on_req=0
            for p in O:
                best=None
                for wid,geo in ways:
                    dd=min(seg_d(p,a,b) for a,b in zip(geo,geo[1:]))
                    key=(round(dd,6),0 if wid in req_ways else 1)
                    if best is None or key<best[0]: best=(key,wid)
                wid=best[1]
                dists=[math.hypot(p[0]-q[0],p[1]-q[1]) for q in R]; k=min(range(len(R)),key=lambda i:dists[i])
                if wid in req_ways: owners.append(k); on_req+=1
                elif k in junction and dists[k]<=junction[k]: pass
                else: off+=1
            first=[]; seen=set()
            for k in owners:
                if k not in seen: seen.add(k); first.append(k)
            covered=len(seen)==len(R); ordered=all(first[i]<=first[i+1] for i in range(len(first)-1))
            r['gt']='VALID' if (off==0 and covered and ordered) else 'CONSTRAINT_UNSATISFIED'
            r['gt_evidence']={'off_required_points':off,'points':len(O),'required_nodes_owned':f'{len(seen)}/{len(R)}','ordered':ordered}
        print(cid,[(r['kind'],r['source'],r['gt']) for r in mine if r['kind'] in('REQUIRED','ENDPOINT')],file=sys.stderr)
    json.dump(rows,open(os.path.join(ROOT,'raw_metrics.json'),'w'),indent=1)
if __name__=='__main__': main()
