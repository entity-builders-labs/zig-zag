const q=`[out:json][timeout:180];relation(1224652);map_to_area->.a;(nwr(area.a)[name][wikidata][~"^(tourism|historic|amenity|leisure|shop|craft|office|healthcare|club|building|public_transport)$"~"."];);out tags center;`;
(async()=>{
 const r=await fetch("http://localhost:12345/api/interpreter",{method:"POST",body:new URLSearchParams({data:q})});
 const els=(await r.json()).elements; const by=new Map();
 for(const e of els){ const k=e.tags.wikidata; if(!by.has(k)) by.set(k,[]); by.get(k).push(e); }
 const shared=[...by].filter(([,v])=>v.length>1);
 console.log("records with wikidata+name:",els.length,"distinct QIDs:",by.size,"QIDs shared by >1 record:",shared.length);
 const ids=shared.map(([k])=>k).filter(k=>/^Q\d+$/.test(k));
 const facts={};
 for(let i=0;i<ids.length;i+=40){ const u="https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=es|en&ids="+ids.slice(i,i+40).join("|");
   const j=await (await fetch(u,{headers:{"User-Agent":"zig-zag-forensic/1.0"}})).json(); Object.assign(facts,j.entities); }
 let located=0, notLocated=[];
 for(const [k,v] of shared){ const f=facts[k]; const loc=!!f?.claims?.P625; const p31=(f?.claims?.P31||[]).map(c=>c.mainsnak.datavalue?.value?.id); if(loc) located++; else notLocated.push(k+" "+(f?.labels?.es?.value||f?.labels?.en?.value)+" P31="+p31.join(",")+" :: "+v.map(e=>e.tags.name).join(" / "));
 }
 console.log("shared located:",located,"shared not located:",notLocated.length); console.log(notLocated.slice(0,25).join("\n"));
 console.log("--- sample located shared:"); console.log(shared.filter(([k])=>facts[k]?.claims?.P625).slice(0,12).map(([k,v])=>k+" "+(facts[k].labels.es?.value||facts[k].labels.en?.value)+" :: "+v.map(e=>e.type+":"+e.tags.name).join(" / ")).join("\n"));
})();
