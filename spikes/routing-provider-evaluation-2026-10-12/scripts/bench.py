import json, time, statistics, urllib.request, concurrent.futures, sys, subprocess
V="http://localhost:8102"
def post(path, body):
    t=time.perf_counter(); req=urllib.request.Request(V+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: out=json.load(r)
    except urllib.error.HTTPError as e: out={'error':e.read().decode()[:300]}
    return out, (time.perf_counter()-t)*1000
pool=json.load(open('ba_pool.json'))
res={'matrix':{}, 'concurrency':{}, 'route':{}, 'trace':{}}
for costing in ('pedestrian','auto','bicycle'):
    for n in (10,20,30,45):
        locs=[{'lat':p['lat'],'lon':p['lon']} for p in pool[:n]]
        lat=[]; nulls=None
        for i in range(5):
            out,ms=post('/sources_to_targets',{'sources':locs,'targets':locs,'costing':costing})
            lat.append(ms)
            if 'error' in out: nulls=out['error']; break
            nulls=sum(1 for row in out['sources_to_targets'] for c in row if c.get('time') is None)
        res['matrix'][f'{costing}:{n}']={'median_ms':round(statistics.median(lat),1),'max_ms':round(max(lat),1),'unreachable_pairs':nulls}
# concurrency: 16 concurrent 30x30 pedestrian matrices
locs=[{'lat':p['lat'],'lon':p['lon']} for p in pool[:30]]
for conc in (1,4,8,16):
    t=time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(conc) as ex:
        lats=list(ex.map(lambda _: post('/sources_to_targets',{'sources':locs,'targets':locs,'costing':'pedestrian'})[1], range(conc*4)))
    wall=time.perf_counter()-t
    res['concurrency'][conc]={'requests':conc*4,'wall_s':round(wall,2),'throughput_rps':round(conc*4/wall,1),'p50_ms':round(statistics.median(lats),1),'max_ms':round(max(lats),1)}
# San Telmo constrained traversal
g=json.load(open('santelmo/defensa_chile_humberto.geojson'))['geometry']['coordinates']
shape=[{'lat':c[1],'lon':c[0]} for c in g]
A,B=shape[0],shape[-1]
for costing in ('pedestrian','auto','bicycle'):
    out,ms=post('/route',{'locations':[A,B],'costing':costing,'directions_options':{'units':'kilometers'}})
    res['route'][costing]={'ms':round(ms,1)}
    if 'trip' in out:
        res['route'][costing].update(length_m=round(out['trip']['summary']['length']*1000,1), time_s=round(out['trip']['summary']['time'],1))
        json.dump(out,open(f'santelmo/valhalla_route_{costing}.json','w'))
    else: res['route'][costing]['error']=out.get('error')
    for mode in ('map_snap','edge_walk','walk_or_snap'):
        out,ms=post('/trace_route',{'shape':shape,'costing':costing,'shape_match':mode,'directions_options':{'units':'kilometers'}})
        key=f'{costing}:{mode}'; res['trace'][key]={'ms':round(ms,1)}
        if 'trip' in out:
            res['trace'][key].update(length_m=round(out['trip']['summary']['length']*1000,1), time_s=round(out['trip']['summary']['time'],1))
            json.dump(out,open(f'santelmo/valhalla_trace_{costing}_{mode}.json','w'))
        else: res['trace'][key]['error']=out.get('error')
    out,ms=post('/trace_attributes',{'shape':shape,'costing':costing,'shape_match':'map_snap','filters':{'attributes':['edge.way_id','edge.names','edge.length','matched.distance_from_trace_point','matched.type'],'action':'include'}})
    if 'edges' in out:
        res['trace'][f'{costing}:attributes']={'way_ids':sorted({e.get('way_id') for e in out['edges']}),'names':sorted({n for e in out['edges'] for n in e.get('names',[])}),
            'max_point_offset_m':round(max(p.get('distance_from_trace_point',0) for p in out.get('matched_points',[])),2),
            'unmatched_points':sum(1 for p in out.get('matched_points',[]) if p.get('type')=='unmatched')}
    else: res['trace'][f'{costing}:attributes']={'error':out.get('error')}
json.dump(res,open('bench_results.json','w'),indent=1); print(json.dumps(res,indent=1))
