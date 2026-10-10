const fs=require('fs');const S=process.argv[2];
const recs=['unit','char','integ'].flatMap(f=>fs.readFileSync(`${S}/${f}.jsonl`,'utf8').trim().split('\n').map(JSON.parse));
const dr=fp=>new Set((fp.components||[]).filter(c=>c.geoEntityId&&c.resolutionState!=='UNRESOLVED').map(c=>c.geoEntityId)).size;
const sc=(a,b)=>{const l=dr(a),r=dr(b);return(l===1&&r>1)||(r===1&&l>1)};
const tally={};const sameVia={};const shapes={};
for(const rec of recs){
  if(rec.decision==='AMBIGUOUS'){
    const fired=new Set();
    for(const {evidence:x,fp} of rec.perCandidate){
      if(x.nameSimilarity>=0.72)fired.add('name');
      if(x.semanticSimilarity>=0.58)fired.add('sem');
      if(!sc(rec.incoming,fp)&&(x.componentOverlap>=0.5||x.roleAwareComponentOverlap>=0.4))fired.add('struct');
    }
    const k=[...fired].sort().join('+');tally[k]=(tally[k]||0)+1;
  }
  if(rec.decision==='SAME'){const k=rec.reasons.includes('exact_structure')?'exact_structure':'strong_consistent_identity';sameVia[k]=(sameVia[k]||0)+1;}
  // shape classification for composite-composite pairs
  for(const c of rec.perCandidate){const a=dr(rec.incoming),b=dr(c.fp);if(a>1&&b>1){
    const ka=new Set((rec.incoming.components||[]).filter(x=>x.geoEntityId).map(x=>x.geoEntityId)),kb=new Set((c.fp.components||[]).filter(x=>x.geoEntityId).map(x=>x.geoEntityId));
    const inter=[...ka].filter(x=>kb.has(x)).length;
    const shape=inter===0?'disjoint':(inter===ka.size&&inter===kb.size)?'equal-set':(inter===ka.size||inter===kb.size)?'subset/superset':'partial-overlap';
    const key=`${shape} -> ${rec.decision}`;shapes[key]=shapes[key]||[];shapes[key].push(`${rec.file.split('/').pop().split('.')[0]}: ${rec.incoming.canonicalName} vs ${c.canonicalName} n=${c.evidence.nameSimilarity.toFixed(2)} s=${c.evidence.semanticSimilarity.toFixed(2)} c=${c.evidence.componentOverlap.toFixed(2)}`);}}
}
console.log('AMBIGUOUS clause attribution:',tally);console.log('SAME via:',sameVia);
for(const [k,v] of Object.entries(shapes)){console.log(`\n## ${k} (${v.length})`);[...new Set(v)].slice(0,14).forEach(x=>console.log('  '+x));}
