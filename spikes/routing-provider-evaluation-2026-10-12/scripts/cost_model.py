"""P-D1 routing cost model. Pricing retrieved 2026-10-12 (see sources in design P-D1 evaluation)."""
import math, json
POOLS=[10,20,30,50]; TOURS=[100,1_000,10_000,100_000]
def full_elems(n, anchors=0): m=n+anchors; return m*m-m          # ordered pairs, no diagonal
def knn_elems(n, k=10, anchors=0): return n*min(k,n-1)+2*anchors*n # sparse shape the optimizer may use
# ---- Geoapify: credits = max(s,t)*min(s,t,10) per request, <=1000 elements/request
def geo_credits_square(n):
    best=None
    for tile in range(2, min(n,31)+1):
        reqs=math.ceil(n/tile)**2; c=0
        for i in range(math.ceil(n/tile)):
            for j in range(math.ceil(n/tile)):
                s=min(tile,n-i*tile); t=min(tile,n-j*tile)
                if s*t>1000: break
                c+=max(s,t)*min(s,t,10)
        best=c if best is None or c<best else best
    return best
def geo_credits_knn(n,k=10): return n*min(k,n-1)  # n one-to-k requests: max(1,k)*min(1,k,10)=k
GEO_PLANS=[(0,3_000),(59,10_000),(109,25_000),(179,50_000),(299,100_000),(609,250_000)]
def geo_monthly(credits_month):
    per_day=credits_month/30
    for price,cap in GEO_PLANS:
        if per_day<=cap: return price, f"{cap:,}/day plan"
    return None, "Custom (unmetered, from $860/mo, quote)"
# ---- Mapbox Matrix: per element, 100k free/month, $2.00/1k to 500k, $1.60 to 1M, $1.20 beyond (5M+ contact sales)
def mapbox_monthly(elems):
    tiers=[(100_000,0.0),(400_000,2.0),(500_000,1.6),(float('inf'),1.2)]; cost=0; left=elems
    for size,price in tiers:
        take=min(left,size); cost+=take/1000*price; left-=take
        if left<=0: break
    return cost
# ---- Google Compute Route Matrix Essentials: 10k free, $5.00/1k first paid tier (higher tiers not retrieved -> upper bound)
def google_monthly(elems): return max(0,elems-10_000)/1000*5.0
rows=[]
for modes in (2,3):
  for n in POOLS:
    fe=full_elems(n,2)*modes; ke=knn_elems(n,10,2)*modes
    gc_full=geo_credits_square(n+2)*modes; gc_knn=geo_credits_knn(n+2)*modes
    for t in TOURS:
        r=dict(modes=modes,pool=n,tours=t,
          elems_full=fe*t, elems_knn=ke*t,
          mapbox_full=round(mapbox_monthly(fe*t)), mapbox_knn=round(mapbox_monthly(ke*t)),
          google_full=round(google_monthly(fe*t)), google_knn=round(google_monthly(ke*t)),
          geo_credits_full=gc_full*t, geo_credits_knn=gc_knn*t)
        r['geo_full']=geo_monthly(gc_full*t); r['geo_knn']=geo_monthly(gc_knn*t)
        rows.append(r)
json.dump(rows,open('cost_rows.json','w'),indent=1)
def fmt(v): return v if isinstance(v,str) else f"${v:,}"
print("per Tour (2 modes, +2 anchors): N, full elements, kNN(k=10) elements, Geoapify credits full/kNN")
for n in POOLS: print(n, full_elems(n,2)*2, knn_elems(n,10,2)*2, geo_credits_square(n+2)*2, geo_credits_knn(n+2)*2)
for modes in (2,):
  print(f"\nmonthly USD, {modes} modes")
  print("pool tours | Mapbox full/kNN | Google full/kNN | Geoapify full/kNN")
  for r in rows:
    if r['modes']!=modes: continue
    g=lambda x: (f"${x[0]}" if x[0] is not None else x[1])
    print(f"{r['pool']:>3} {r['tours']:>7} | {fmt(r['mapbox_full']):>10} / {fmt(r['mapbox_knn']):>9} | {fmt(r['google_full']):>10} / {fmt(r['google_knn']):>9} | {g(r['geo_full'])} / {g(r['geo_knn'])}")
