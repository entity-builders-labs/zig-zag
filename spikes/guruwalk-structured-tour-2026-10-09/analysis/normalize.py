"""Build lossless normalized fixtures + BA coverage table from raw/ (GURUWALK-STRUCTURED-TOUR-1).
Run from the dossier root: python3 analysis/normalize.py"""
import json,glob,re,statistics,html,sys
sys.path.insert(0,'analysis'); from extract_web_pois import pois as web_pois
def load(l):
    d={}
    for f in sorted(glob.glob(f'raw/mcp/ba-detail-free-{l}-b*.json')):
        for r in json.load(open(f))['result']['structuredContent']['results']: d[r['product_id']]=r
    return d
en,es=load('en'),load('es')
WEB={63551:'raw/web/walk-63551-es.html',56186:'raw/web/walk-56186-es.html',62981:'raw/web/walk-62981-es.html'}
for pid,path in WEB.items():
    wp=web_pois(path)[0]
    fx={'spike':'GURUWALK-STRUCTURED-TOUR-1','captured':'2026-10-09','product_id':pid,'type':'free_tour',
        'mcp_detail_en':en[pid],'mcp_detail_es':es[pid],
        'web_pois_es':{'note':'Characterization only: embedded RSC `pois` from the public tour page; NOT part of the official MCP contract.','source':path,'pois':wp},
        'comparison':[{'position_web':p['position'],'poiId':p['poiId'],'type':p['type'],'title_web_es':p['title'],
            'mcp_es':(es[pid]['itinerary'][i] if i<len(es[pid]['itinerary']) else None),
            'mcp_en':(en[pid]['itinerary'][i] if i<len(en[pid]['itinerary']) else None),
            'lat':p['latitude'],'lon':p['longitude'],'has_description':bool(p.get('description'))} for i,p in enumerate(wp)]}
    json.dump(fx,open(f'normalized/tour-{pid}.json','w'),ensure_ascii=False,indent=1)
# Coverage table
GROUPS=[('San Telmo',r'san telmo|monserrat|montserrat'),('La Boca',r'la boca|\bboca\b'),('Recoleta',r'recoleta|retiro'),('Historic center',r'historic|heart of the city|city center|essential|first-time|welcome|centro|plaza de mayo|paris of')]
def grp(r):
    n=(r['name']+' '+es[r['id']]['name']).lower()
    return [g for g,rx in GROUPS if re.search(rx,n)] or ['other']
m=json.load(open('analysis/ba-free-tour-metrics.json'))
for r in m:
    it=es[r['id']].get('itinerary') or []
    r['groups']=grp(r)
    r['freetext_member']=[x for x in it if x.count(',')>=2]  # comma-joined prose list in one member
    r['distinct_es']=len(set(it))
    r['usable_list']=r['distinct_es']>=3 and not r['freetext_member']
    r['url']=en[r['id']]['url'].split('?')[0]
json.dump(m,open('analysis/ba-free-tour-metrics.json','w'),ensure_ascii=False,indent=1)
lines=['| id | title (en) | groups | dur (min) | stops es (distinct) | en dup/corrupt | area-level members | meeting coords | usable member list |','|---|---|---|---|---|---|---|---|---|']
for r in sorted(m,key=lambda x:(x['groups'][0],-(x['reviews'] or 0))):
    lines.append(f"| [{r['id']}]({r['url']}) | {r['name'][:60].replace('|','/')} | {', '.join(r['groups'])} | {r['dur']} | {r['n_es']} ({r['distinct_es']}) | {'yes' if r['dup_en'] else ''} | {'; '.join(r['area'])} | {'yes' if r['coords'] else 'no'} | {'yes' if r['usable_list'] else 'NO'} |")
open('analysis/ba-coverage-table.md','w').write('\n'.join(lines)+'\n')
tgt=[r for r in m if r['groups']!=['other']]
print('total',len(m),'target-relevant',len(tgt),'usable lists',sum(r['usable_list'] for r in m),'target usable',sum(r['usable_list'] for r in tgt))
print('groups',{g:sum(g in r['groups'] for r in m) for g,_ in GROUPS})
print('not usable:',[(r['id'],r['n_es'],r['freetext_member'][:1]) for r in m if not r['usable_list']])
print('distinct guides',len({r['guide'] for r in m}))
print('en-only-dup tours',[r['id'] for r in m if r['dup_en']])
