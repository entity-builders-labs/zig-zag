import json,sys,urllib.request,os
URL="https://back.guruwalk.com/mcp"
OUT=os.environ.get("OUT")
def call(method,params=None,id=1):
    body={"jsonrpc":"2.0","id":id,"method":method}
    if params is not None: body["params"]=params
    req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18","User-Agent":"zigzag-spike/1.0"})
    with urllib.request.urlopen(req,timeout=60) as r:
        raw=r.read().decode(); ct=r.headers.get("content-type","")
    if "event-stream" in ct:
        data=[l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
        raw=data[-1]
    return json.loads(raw)
if __name__=="__main__":
    method=sys.argv[1]; params=json.loads(sys.argv[2]) if len(sys.argv)>2 else None
    if method!="initialize":
        call("initialize",{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"zigzag-spike","version":"1"}})
    res=call(method,params,2)
    s=json.dumps(res,ensure_ascii=False,indent=1)
    if OUT: open(OUT,"w").write(s)
    print(s[:int(os.environ.get("N","4000"))])
