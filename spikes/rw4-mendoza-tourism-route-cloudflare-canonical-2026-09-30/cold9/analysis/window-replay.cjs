const fs = require('fs');
const { windowSourceContent } = require(process.cwd() + '/be/dist/src/modules/tours/utils/source-content-windowing.util.js');
const content = fs.readFileSync('spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md', 'utf8');
const base = 'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/';
const names = ['Alfa Crux', 'SuperUco', 'Bodega Azul', 'Corazon del Sol', 'Solo Contigo'];
function inputs(dir) {
  const t = JSON.parse(fs.readFileSync(base + dir + '/generation-trace.json', 'utf8'));
  const ws = t.steps.find((s) => s.name === 'acquisition.web_search' && /generic/.test(s.parentId || ''));
  const ev = ws.facts.groundedEvidence.filter((e) => /solsalute/.test(e.url));
  return { titles: ev.map((e) => e.title).filter(Boolean), snippets: ev.map((e) => e.snippet).filter(Boolean), queries: [ws.facts.query, ws.facts.semanticQuery].filter(Boolean) };
}
function run(label, ctx) {
  const w = windowSourceContent(content, ctx, 6000);
  const ex = w.audit.selectedExcerpts.map((e) => `${e.start}-${e.end}`);
  console.log(JSON.stringify({ label, originalChars: w.audit.originalContentChars, excerpts: ex, retained: names.filter((n) => new RegExp(n, 'i').test(w.content)) }));
}
const c7 = inputs('cold_prev_13933cc7'), c9 = inputs('cold9');
run('COLD7 inputs', c7);
run('COLD9 inputs', c9);
run('COLD9 query + COLD7 snippet', { ...c9, snippets: c7.snippets });
run('COLD7 query + COLD9 snippet', { ...c7, snippets: c9.snippets });
console.log('full source contains', names.filter((n) => new RegExp(n, 'i').test(content)));
