"""Does authored `position` order look like a walking sequence? Compare authored path length
with a greedy nearest-neighbour path from the same first stop (characterization only)."""
import json,math
def hav(a,b):
    R=6371000;p1,p2=math.radians(a[0]),math.radians(b[0]);dl=math.radians(b[1]-a[1]);dp=p2-p1
    return 2*R*math.asin(math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
for pid in (56186,63551,62981):
    fx=json.load(open(f'normalized/tour-{pid}.json')); P=[(p['latitude'],p['longitude']) for p in fx['web_pois_es']['pois']]
    mp=(fx['mcp_detail_es']['meeting_point_latitude'],fx['mcp_detail_es']['meeting_point_longitude'])
    auth=sum(hav(P[i],P[i+1]) for i in range(len(P)-1))
    rem=P[1:];cur=P[0];nn=0
    while rem:
        j=min(range(len(rem)),key=lambda k:hav(cur,rem[k]));nn+=hav(cur,rem[j]);cur=rem.pop(j)
    far=max(hav(mp,p) for p in P)
    print(pid,f'stops={len(P)} authored={auth:.0f}m greedyNN={nn:.0f}m ratio={auth/nn:.2f} meeting->first={hav(mp,P[0]):.0f}m max_from_meeting={far:.0f}m')
