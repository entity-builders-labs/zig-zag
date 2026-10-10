const q=`[out:json][timeout:180];relation(1224652);map_to_area->.a;(nwr(area.a)[name][wikidata][~"^(tourism|historic|amenity|leisure|shop|craft|office|healthcare|club|building|public_transport)$"~"."];);out tags geom;`;
const pip=(pt,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=[ring[i].lon,ring[i].lat],[xj,yj]=[ring[j].lon,ring[j].lat]; if(((yi>pt.lat)!=(yj>pt.lat))&&(pt.lon<(xj-xi)*(pt.lat-yi)/(yj-yi)+xi)) c=!c;} return c;};
const point=e=>e.type==="node"?{lat:e.lat,lon:e.lon}:null;
const rings=e=>e.type==="way"&&e.geometry&&e.geometry.length>3&&e.geometry[0].lat===e.geometry.at(-1).lat?[e.geometry]:e.type==="relation"?(e.members||[]).filter(m=>m.role==="outer"&&m.geometry).map(m=>m.geometry):[];
(async()=>{
 const els=(await (await fetch("http://localhost:12345/api/interpreter",{method:"POST",body:new URLSearchParams({data:q})})).json()).elements;
 const by=new Map(); for(const e of els){(by.get(e.tags.wikidata)||by.set(e.tags.wikidata,[]).get(e.tags.wikidata)).push(e);}
 const shared=[...by].filter(([,v])=>v.length>1);
 const ids=shared.map(([k])=>k).filter(k=>/^Q\d+$/.test(k)); const facts={};
 for(let i=0;i<ids.length;i+=40){const j=await (await fetch("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids="+ids.slice(i,i+40).join("|"),{headers:{"User-Agent":"zig-zag-forensic/1.0"}})).json(); Object.assign(facts,j.entities);}
 for(const [k,v] of shared){ const located=!!facts[k]?.claims?.P625; const pairs=[];
   for(const a of v) for(const b of v){ if(a===b) continue; const p=point(a); const rs=rings(b); if(p&&rs.some(r=>pip(p,r))) pairs.push(`${a.type}:${a.tags.name} ⊂ ${b.type}:${b.tags.name}`); }
   console.log((located?"LOC ":"NOL ")+(pairs.length?"CONTAINED ":"separate  ")+k.padEnd(11), v.map(e=>e.type+":"+e.tags.name).join(" / ").slice(0,150), pairs.length?"\n          "+pairs.join("; "):""); }
})();
