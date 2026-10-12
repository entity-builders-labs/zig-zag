"""Build frozen planner fixtures (BA, PA, LA). Raw provider responses cached in fixtures/raw."""
import json, os, math, time, urllib.request, urllib.parse
import opening_hours as OH
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE); RAW=os.path.join(ROOT,'fixtures','raw')
SPIKE3=os.path.join(ROOT,'..','structured-places-baseline-2026-10-11','runs','S3-A','report.json')
G2=os.path.join(ROOT,'..','routing-provider-evaluation-2026-10-12','g2')
OVERPASS={'BA':'http://localhost:12345/api/interpreter','PA':'https://maps.mail.ru/osm/tools/overpass/api/interpreter','LA':'https://maps.mail.ru/osm/tools/overpass/api/interpreter'}
UA={'User-Agent':'zig-zag-planner-comparison/1.0 (research; bounded)'}
def cached(name,fn):
    p=os.path.join(RAW,name)
    if os.path.exists(p): return json.load(open(p))
    d=fn(); json.dump(d,open(p,'w')); return d
def overpass(city,q,name):
    def go():
        for i in range(5):
            try:
                req=urllib.request.Request(OVERPASS[city],data=urllib.parse.urlencode({'data':q}).encode(),headers=UA)
                with urllib.request.urlopen(req,timeout=240) as r: return json.load(r)
            except Exception as e: print('retry',name,e); time.sleep(15*(i+1))
        raise RuntimeError(name)
    return cached(name,go)
def wikidata(qids,name):
    def go():
        out={}
        for i in range(0,len(qids),50):
            url='https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&ids='+'|'.join(qids[i:i+50])
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r: d=json.load(r)
            for k,v in d.get('entities',{}).items(): out[k]=len(v.get('sitelinks',{}))
            time.sleep(1)
        return out
    return cached(name,go)
def center(e):
    if e['type']=='node': return e['lat'],e['lon']
    c=e.get('center') or {}; return c.get('lat'),c.get('lon')
def hours(tags):
    raw=tags.get('opening_hours'); parsed=OH.parse(raw)
    return {'status':'KNOWN' if parsed is not None else 'UNKNOWN','weekly':parsed,'source':'osm:opening_hours' if raw else None,'raw':raw}
def hotel(city,lat,lon):
    q=f'[out:json][timeout:120];nwr["tourism"="hotel"]["name"](around:1500,{lat},{lon});out center tags;'
    d=overpass(city,q,f'{city}_hotels.json')
    best=min((e for e in d['elements'] if center(e)[0]),key=lambda e:(center(e)[0]-lat)**2+((center(e)[1]-lon)*math.cos(math.radians(lat)))**2)
    la,lo=center(best); return {'id':f"osm:{best['type']}:{best['id']}",'name':best['tags'].get('name'),'lat':la,'lon':lo}
FIXTURE_DURATION={'museum':90,'gallery':60,'zoo':120,'theme_park':180,'aquarium':90,'attraction':45,'viewpoint':20,'artwork':15,'monument':20,'memorial':20,'castle':45,'church':30}
def fixture_duration(tags):
    for k in ('tourism','historic','amenity','building'):
        v=tags.get(k)
        if v in FIXTURE_DURATION: return FIXTURE_DURATION[v],f'FIXTURE_CLASS_RULE:{k}={v}'
    return 45,'FIXTURE_CLASS_RULE:default'
def build_ba():
    pool=sorted(json.load(open(SPIKE3))['report']['plannerInput'],key=lambda x:-x['semanticScore'])[:28]
    ids={'node':[],'way':[],'relation':[]}
    for x in pool:
        _,_,typ,i=x['experienceId'].split('place=')[1].split(':'); ids[typ].append(i)
    q='[out:json][timeout:120];('+''.join(f'{t}(id:{",".join(v)});' for t,v in ids.items() if v)+');out center tags;'
    d=overpass('BA',q,'BA_tags.json'); tags={f"{e['type']}:{e['id']}":e.get('tags',{}) for e in d['elements']}
    cands=[]
    for x in pool:
        key=':'.join(x['experienceId'].split('place=')[1].split(':')[2:]); t=tags.get(key,{})
        cands.append({'id':'BA:'+key,'title':x['title'],'kind':'SINGLE','desirability':round(x['semanticScore'],4),'desirability_source':'spike3 ranking-spike3-1 semanticScore',
            'components':[{'participation':'VISIT','geo':'osm:'+key,'lat':x['point']['lat'],'lon':x['point']['lng'],'duration_min':x['durationMinutes'],'duration_source':'spike3 FALLBACK_POLICY 60','hours':hours(t)}]})
    # composite San Telmo walk: TRAVERSE Defensa (G2 BA-00) -> VISIT Mercado de San Telmo
    seg=[s for s in json.load(open(os.path.join(G2,'segments.json'))) if s['id']=='BA-00'][0]
    mm=[r for r in json.load(open(os.path.join(G2,'raw_metrics.json'))) if r['output_id']=='BA-00:geoapify:REQUIRED:walk'][0]
    mq='[out:json][timeout:60];nwr["name"="Mercado de San Telmo"](-34.625,-58.378,-34.615,-58.368);out center tags;'
    md=overpass('BA',mq,'BA_mercado.json'); me=[e for e in md['elements'] if center(e)[0]][0]; mla,mlo=center(me)
    coords=seg['required']['geometry']['coordinates']
    cands.append({'id':'BA:composite:san-telmo-walk','title':'San Telmo walk (Defensa Chile→Humberto I, Mercado de San Telmo)','kind':'COMPOSITE','desirability':0.85,'desirability_source':'FIXTURE (composite not ranked by spike 3)',
        'components':[{'participation':'TRAVERSE','geo':'osm:route:Defensa','from':{'lat':coords[0][1],'lon':coords[0][0]},'to':{'lat':coords[-1][1],'lon':coords[-1][0]},
                       'traverse_min':round(mm['provider_meta']['time']/60,2),'traverse_source':'geoapify mapmatching walk (G2 BA-00)','segment_osm_ways':seg['required']['properties']['osm_way_ids']},
                      {'participation':'VISIT','geo':f"osm:{me['type']}:{me['id']}",'lat':mla,'lon':mlo,'duration_min':45,'duration_source':'FIXTURE','hours':hours(me.get('tags',{}))}]})
    return cands
def build_snapshot(city,bbox):
    q=(f'[out:json][timeout:180];(nwr["tourism"~"^(museum|gallery|attraction|viewpoint|zoo|aquarium)$"]["wikidata"]({bbox});'
       f'nwr["historic"~"^(monument|castle|memorial)$"]["wikidata"]["tourism"]({bbox}););out center tags;')
    d=overpass(city,q,f'{city}_places.json')
    els=[e for e in d['elements'] if center(e)[0] and e.get('tags',{}).get('name')]
    seen={}; 
    for e in els:
        qid=e['tags']['wikidata']
        if qid not in seen: seen[qid]=e
    sl=wikidata(sorted(seen),f'{city}_sitelinks.json')
    ranked=sorted(seen.values(),key=lambda e:(-sl.get(e['tags']['wikidata'],0),e['tags']['wikidata']))[:30]
    mx=max(math.log1p(sl.get(e['tags']['wikidata'],0)) for e in ranked)
    out=[]
    for e in ranked:
        la,lo=center(e); dur,src=fixture_duration(e['tags'])
        out.append({'id':f"{city}:{e['type']}:{e['id']}",'title':e['tags']['name'],'kind':'SINGLE','wikidata':e['tags']['wikidata'],'sitelinks':sl.get(e['tags']['wikidata'],0),
            'desirability':round(math.log1p(sl.get(e['tags']['wikidata'],0))/mx,4),'desirability_source':'log(1+wikidata sitelinks) normalized per city',
            'components':[{'participation':'VISIT','geo':f"osm:{e['type']}:{e['id']}",'lat':la,'lon':lo,'duration_min':dur,'duration_source':src,'hours':hours(e['tags'])}]})
    return out
def main():
    meta={'BA':('America/Argentina/Buenos_Aires',None),'PA':('Europe/Paris','48.845,2.285,48.880,2.370'),'LA':('America/Los_Angeles','33.990,-118.500,34.140,-118.230')}
    for city,(tz,bbox) in meta.items():
        cands=build_ba() if city=='BA' else build_snapshot(city,bbox)
        pts=[c for x in cands for c in x['components']]
        lat=sum(p.get('lat',p.get('from',{}).get('lat',0)) for p in pts)/len(pts); lon=sum(p.get('lon',p.get('from',{}).get('lon',0)) for p in pts)/len(pts)
        fx={'city':city,'timezone':tz,'fixture_version':'pc-2026-10-12','candidates':cands,'hotel':hotel(city,lat,lon)}
        json.dump(fx,open(os.path.join(ROOT,'fixtures',f'{city}.json'),'w'),indent=1)
        print(city,len(cands),'KNOWN',sum(1 for x in cands for c in x['components'] if c.get('hours',{}).get('status')=='KNOWN'),'hotel',fx['hotel']['name'])
if __name__=='__main__': main()
