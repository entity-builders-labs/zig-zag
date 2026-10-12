"""Append Valhalla (Ile-de-France tiles) outputs for the Paris cases to raw_metrics.json.
Same normalization, metrics and output naming as run_eval.py; Geoapify is not re-called."""
import json, os, sys
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
os.environ.setdefault('VALHALLA_URL','http://localhost:8103')
sys.path.insert(0,HERE); import run_eval as E
E.VALHALLA=os.environ['VALHALLA_URL']
rows=json.load(open(os.path.join(ROOT,'raw_metrics.json')))
rows=[r for r in rows if not (r['city']=='PA' and r['source']=='valhalla')]
for s in json.load(open(os.path.join(ROOT,'segments.json'))):
    if 'required' not in s or s['city']!='PA': continue
    req=s['required']['geometry']['coordinates']; alts={k:v['geometry']['coordinates'] for k,v in s['alternatives'].items()}
    def add(kind,expected,res,api):
        ll,um,ms,meta=res
        m=E.metrics(req,ll,um) if ll else {'provider_error':meta}
        row={'case':s['id'],'city':'PA','street':s['street'],'output_id':f"{s['id']}:valhalla:{kind}:pedestrian",'source':'valhalla','provider':'valhalla-3.9.1','api':api,'mode':'pedestrian',
             'kind':kind,'expected':expected,'label':expected,'label_evidence':{},'latency_ms':ms,'provider_meta':meta,**m}
        rows.append(row); json.dump(ll,open(os.path.join(ROOT,'outputs',row['output_id'].replace(':','__')+'.json'),'w'))
    add('REQUIRED','VALID',E.val_trace(req),'trace_route')
    for k,g in alts.items(): add(k,'CONSTRAINT_UNSATISFIED',E.val_trace(g),'trace_route')
    add('ENDPOINT','?',E.val_route(req[0],req[-1]),'route')
    print(s['id'],file=sys.stderr)
json.dump(rows,open(os.path.join(ROOT,'raw_metrics.json'),'w'),indent=1)
