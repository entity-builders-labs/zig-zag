"""Reproducible analysis over raw/mcp/ba-detail-free-{en,es}-b*.json (GURUWALK-STRUCTURED-TOUR-1)."""
import json,glob,re,statistics,html
def load(l):
    d={}
    for f in sorted(glob.glob(f'raw/mcp/ba-detail-free-{l}-b*.json')):
        for r in json.load(open(f))['result']['structuredContent']['results']: d[r['product_id']]=r
    return d
en,es=load('en'),load('es')
# Area-level labels: neighborhoods / generic nouns that are not a single POI (explicit list, no inference).
AREA={'montserrat','monserrat','san telmo','la boca','recoleta','retiro','palermo','palermo soho','puerto madero','barracas','abasto','microcentro','san nicolás','barrio parque','chacarita','costanera sur','belgrano','caminito'}
GENERICISH=re.compile(r'^(avenue|avenida|calle|street|plaza|park|square)$|^\d|&|\bcorner\b|^[A-Za-zÁÉÍÓÚáéíóúñ]+ \d+$',re.I)
def dur(s):
    if isinstance(s,int): return s
    m=re.match(r'(\d+):(\d+)',str(s)); return int(m[1])*60+int(m[2]) if m else None
rows=[]
for pid,r in en.items():
    e=es.get(pid,{}); it_en=r.get('itinerary') or []; it_es=e.get('itinerary') or []
    desc=html.unescape(re.sub('<[^>]+>',' ',r.get('description_html','')))
    route_section=bool(re.search(r'route|itinerary|recorrido|stops|we will visit|we\'ll visit|highlights',desc,re.I))
    rows.append(dict(id=pid,name=r['name'],dur=dur(r.get('duration')),n_en=len(it_en),n_es=len(it_es),
        dup_en=len(it_en)-len(set(it_en)),same_len=len(it_en)==len(it_es),
        area=[x for x in it_es if x.strip().lower() in AREA],
        entity=[x for x in it_en+it_es if '&quot;' in x or '&amp;' in x],
        coords=r.get('meeting_point_latitude') is not None,
        route_text=route_section,langs=r.get('available_languages'),guide=(r.get('guide') or {}).get('name'),
        reviews=(r.get('reviews') or {}).get('count')))
json.dump(rows,open('analysis/ba-free-tour-metrics.json','w'),ensure_ascii=False,indent=1)
n=len(rows); ds=[x['dur'] for x in rows if x['dur']]
print('tours',n,'| duration median',statistics.median(ds),'range',min(ds),max(ds))
print('itinerary non-empty (en)',sum(x['n_en']>0 for x in rows),'| >=3 stops',sum(x['n_en']>=3 for x in rows),'| empty',sum(x['n_en']==0 for x in rows))
print('stop count median',statistics.median([x['n_en'] for x in rows]),'range',min(x['n_en'] for x in rows),max(x['n_en'] for x in rows))
print('en/es length mismatch',sum(not x['same_len'] for x in rows),'| en duplicates',sum(x['dup_en']>0 for x in rows))
print('contains area-level member (es)',sum(bool(x['area']) for x in rows),'| html-entity leak',sum(bool(x['entity']) for x in rows))
print('meeting coords',sum(x['coords'] for x in rows),'| route-ish text in description',sum(x['route_text'] for x in rows))
# en/es positional divergence beyond translation: count positions where one side is identical-in-both is impossible to judge; report raw diffs for review
div=[]
for pid in en:
    a,b=en[pid].get('itinerary') or [],es[pid].get('itinerary') or []
    if len(a)!=len(b): div.append((pid,len(a),len(b)))
print('length-divergent ids',div)
