"""Characterization only: extract the embedded `pois` array from a public GuruWalk tour page
(Next.js RSC payload). Used to compare platform-held composition vs. the official MCP projection."""
import re,json,sys
def pois(path):
    s=open(path).read().replace('\\"','"').replace('\\\\','\\')
    out=[]
    for m in re.finditer(r'"pois":\[',s):
        i=m.end()-1;depth=0
        for j in range(i,len(s)):
            if s[j]=='[':depth+=1
            elif s[j]==']':
                depth-=1
                if depth==0: break
        try: out.append(json.loads(s[i:j+1]))
        except Exception as e: out.append({'parse_error':str(e),'raw':s[i:i+300]})
    return out
if __name__=='__main__':
    for p in sys.argv[1:]:
        r=pois(p); print(p,'pois arrays:',len(r))
        uniq=[]
        for a in r:
            if a not in uniq: uniq.append(a)
        print(json.dumps(uniq,ensure_ascii=False,indent=1))
