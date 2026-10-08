const fs = require('fs');
const S = process.argv[2];
const recs = ['unit','char','integ'].flatMap(f => fs.readFileSync(`${S}/${f}.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const distinctResolved = (fp) => new Set((fp.components||[]).filter(c => c.geoEntityId && c.resolutionState !== 'UNRESOLVED').map(c=>c.geoEntityId)).size;
const sc = (a,b) => { const l=distinctResolved(a), r=distinctResolved(b); return (l===1&&r>1)||(r===1&&l>1); };
function decide(rec, T) {
  const ranked = rec.perCandidate; // already ranked order not guaranteed; recompute score
  const score = e => { const d = e.distanceKm==null?0:e.distanceKm<=0.5?0.08:e.distanceKm<=1.5?0.04:0;
    return e.nameSimilarity*0.22+e.semanticSimilarity*0.2+e.componentOverlap*0.15+e.roleAwareComponentOverlap*0.3+e.provenanceOverlap*0.05+d; };
  const r = [...ranked].sort((a,b)=>score(b.evidence)-score(a.evidence));
  if (!r.length) return 'NEW';
  const e = r[0].evidence;
  const exact = e.roleAwareComponentOverlap===1&&e.componentOverlap===1&&(e.nameSimilarity===1||e.conceptOverlap===1)&&!e.orderConflict;
  const strong = e.nameSimilarity>=0.86&&e.semanticSimilarity>=0.72&&e.roleAwareComponentOverlap>=0.8&&(e.distanceKm==null||e.distanceKm<=1.5)&&!e.orderConflict;
  if (exact||strong) return 'SAME';
  const amb = r.filter(({evidence:x, fp}) => x.nameSimilarity>=0.72 || x.semanticSimilarity>=T || (!sc(rec.incoming, fp) && (x.componentOverlap>=0.5||x.roleAwareComponentOverlap>=0.4)));
  return amb.length ? 'AMBIGUOUS' : 'NEW';
}
const Ts = [0.40,0.50,0.55,0.58,0.60,0.65,0.70,0.80,Infinity];
let mismatch=0; const rows=[];
for (const rec of recs) {
  const at = Ts.map(T=>decide(rec,T));
  if (at[3] !== rec.decision) mismatch++;
  const best = [...rec.perCandidate].sort((a,b)=>b.evidence.semanticSimilarity-a.evidence.semanticSimilarity)[0];
  rows.push({ file: rec.file.split('/').pop().replace(/\.(integration-spec|characterization-spec|spec)\.ts$/,''), test: rec.test, actual: rec.decision, at,
    maxSem: best? +best.evidence.semanticSimilarity.toFixed(3):null,
    inc: `${rec.incoming.canonicalName} [${(rec.incoming.components||[]).length}m/${distinctResolved(rec.incoming)}r]`,
    cands: rec.perCandidate.map(c=>`${c.canonicalName} [${c.componentCount}m/${distinctResolved(c.fp)}r] n=${c.evidence.nameSimilarity.toFixed(2)} s=${c.evidence.semanticSimilarity.toFixed(2)} c=${c.evidence.componentOverlap.toFixed(2)} r=${c.evidence.roleAwareComponentOverlap.toFixed(2)} k=${c.evidence.conceptOverlap.toFixed(2)}`)});
}
console.log('records', recs.length, 'replay mismatches vs actual at 0.58:', mismatch);
const sens = rows.filter(r => new Set(r.at).size>1);
console.log('threshold-sensitive records:', sens.length);
console.log('T:', Ts.join(' | '));
for (const r of sens) { console.log(`\n[${r.file}] ${r.test}\n  actual=${r.actual} at=${r.at.join(',')} maxSem=${r.maxSem}\n  in: ${r.inc}`); r.cands.forEach(c=>console.log('   vs '+c)); }
fs.writeFileSync(`${S}/rows.json`, JSON.stringify(rows,null,1));
// decision counts
for (const [i,T] of Ts.entries()) { const c={}; rows.forEach(r=>c[r.at[i]]=(c[r.at[i]]||0)+1); console.log('T',T,JSON.stringify(c)); }
