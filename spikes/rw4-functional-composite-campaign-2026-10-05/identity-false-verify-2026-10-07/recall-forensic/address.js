const q=`[out:json][timeout:180];relation(1224652);map_to_area->.a;(nwr(area.a)[name][wikidata][~"^(tourism|historic|amenity|leisure|shop|craft|office|healthcare|club|building|public_transport)$"~"."];);out tags;`;
const norm=s=>(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
(async()=>{
 const els=(await (await fetch("http://localhost:12345/api/interpreter",{method:"POST",body:new URLSearchParams({data:q})})).json()).elements;
 const by=new Map(); for(const e of els){(by.get(e.tags.wikidata)||by.set(e.tags.wikidata,[]).get(e.tags.wikidata)).push(e);}
 for(const [k,v] of [...by].filter(([,v])=>v.length>1)){
   const addrs=v.map(e=>e.tags["addr:street"]&&e.tags["addr:housenumber"]?norm(e.tags["addr:street"])+" "+norm(e.tags["addr:housenumber"]):null);
   const groups={}; addrs.forEach((a,i)=>{ if(a){(groups[a]=groups[a]||[]).push(v[i].type+":"+v[i].tags.name);} });
   const same=Object.entries(groups).filter(([,g])=>g.length>1);
   console.log((same.length?"SAME_ADDRESS ":"no-pair      ")+k.padEnd(11), "with-address:", addrs.filter(Boolean).length+"/"+v.length, same.map(([a,g])=>`[${a}] ${g.join(" + ")}`).join("; ").slice(0,220));
 }
})();
