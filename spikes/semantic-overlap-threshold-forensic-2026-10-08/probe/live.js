// Read-only: extract real dedupe evidence objects from live spike traces.
const fs = require('fs');
const files = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const uniq = new Map();
function walk(o, file, ctx) {
  if (!o || typeof o !== 'object') return;
  if ('semanticSimilarity' in o && 'componentOverlap' in o && 'nameSimilarity' in o) {
    const k = (ctx.name || '?') + JSON.stringify(o);
    if (!uniq.has(k)) uniq.set(k, { name: ctx.name, decision: ctx.decision, reason: ctx.reason, ev: o, files: new Set() });
    uniq.get(k).files.add(file.split('/')[1]);
    return;
  }
  const n = { ...ctx };
  if (typeof o.canonicalName === 'string') n.name = o.canonicalName;
  else if (typeof o.name === 'string' && !n.name) n.name = o.name;
  if (typeof o.dedupeDecision === 'string') n.decision = o.dedupeDecision;
  else if (typeof o.status === 'string' && !n.decision) n.decision = o.status;
  if (Array.isArray(o.rejectionReasons)) n.reason = o.rejectionReasons.join(',');
  for (const v of Object.values(o)) walk(v, file, n);
}
for (const f of files) {
  try { walk(JSON.parse(fs.readFileSync(f, 'utf8')), f, {}); } catch (e) { console.error('skip', f, e.message); }
}
console.log('unique evidence objects', uniq.size);
const Ts = [0.4, 0.5, 0.58, 0.65, 0.7, 0.8];
for (const r of uniq.values()) {
  const e = r.ev;
  const sc = (e.reasons || []).includes('standalone_composite_shared_membership');
  const nm = e.nameSimilarity >= 0.72;
  const st = !sc && (e.componentOverlap >= 0.5 || e.roleAwareComponentOverlap >= 0.4);
  const flips = Ts.filter((T) => !nm && !st && e.semanticSimilarity >= T);
  console.log(
    `- ${r.name} | dec=${r.decision} rej=${r.reason || ''} | n=${e.nameSimilarity.toFixed(2)} s=${e.semanticSimilarity.toFixed(2)} c=${e.componentOverlap.toFixed(2)} r=${e.roleAwareComponentOverlap.toFixed(2)} k=${e.conceptOverlap == null ? 'NA' : e.conceptOverlap.toFixed(2)} sc=${sc}` +
      ` | name=${nm} struct=${st} semOnlyAMB@[${flips.join(',')}] | ${[...r.files].join(',')}`,
  );
}
