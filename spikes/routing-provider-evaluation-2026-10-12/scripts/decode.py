import json, sys
def decode(s, prec=6):
    coords=[];lat=lon=0;i=0;f=10**prec
    while i<len(s):
        for which in (0,1):
            shift=res=0
            while True:
                b=ord(s[i])-63;i+=1;res|=(b&0x1f)<<shift;shift+=5
                if b<0x20: break
            d=~(res>>1) if res&1 else res>>1
            if which==0: lat+=d
            else: lon+=d
        coords.append([lon/f,lat/f])
    return coords
o=json.load(open(sys.argv[1])); pts=[c for leg in o['trip']['legs'] for c in decode(leg['shape'])]
json.dump({'type':'Feature','geometry':{'type':'LineString','coordinates':pts}},open(sys.argv[2],'w'))
