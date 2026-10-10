// Cross-matrix: every historical SolSalute query x every observed SolSalute
// snippet (plus none) x every stored source rendering, per policy.
const fs = require('fs');
const { POLICIES, windowWith } = require('./policy-eval.cjs'); Object.assign(POLICIES, require('./extra-policies.cjs')); for (const k of Object.keys(POLICIES)) if (!/^[EFG]/.test(k)) delete POLICIES[k];
const traces = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const queries = new Set(), snippets = new Set(), titles = new Set(), observed = [];
for (const f of traces) {
  let t; try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const s of t.steps || []) {
    if (s.name !== 'acquisition.web_search') continue;
    for (const e of (s.facts.groundedEvidence || []).filter((e) => /solsalute\.com\/blog\/mendoza-argentina-wine/.test(e.url))) {
      const q = [s.facts.query, s.facts.semanticQuery].filter(Boolean);
      q.forEach((x) => queries.add(x)); snippets.add(e.snippet); titles.add(e.title);
      observed.push({ label: f.split('/').slice(-2, -1)[0] + ':' + s.parentId.replace('acquisition-pass-1-', ''), titles: [e.title], snippets: [e.snippet], queries: q });
    }
  }
}
const sources = {
  cloudflare: 'spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md',
  tavilyAdvMd: 'spikes/rw4-tavily-extract-fidelity-2026-10-01/outputs/advanced-markdown.md',
  tavilyAdvTxt: 'spikes/rw4-tavily-extract-fidelity-2026-10-01/outputs/advanced-text.txt',
  tavilyBasicMd: 'spikes/rw4-tavily-extract-fidelity-2026-10-01/outputs/basic-markdown.md',
};
const ESSENTIAL = ['Alfa Crux', 'SuperUco', 'Bodega Azul'];
const OPTIONAL = ['Corazon del Sol', 'Solo Contigo'];
// Tavily basic drops the stop lists; the original 9692c780 requirement there
// was keeping the advertised itinerary section (headings + intros).
const BASIC_MARKERS = ['Sample Mendoza Winery Itineraries', 'Uco Valley Itinerary'];
const title = [...titles][0];
const ctxs = [];
for (const q of queries) for (const s of [...snippets, null]) ctxs.push({ label: `q=${q} s=${s ? s.slice(80, 120) : 'NONE'}`, titles: [title], snippets: s ? [s] : [], queries: [q] });
const mode = process.argv[3] || 'summary';
const out = {};
for (const [pname, pol] of Object.entries(POLICIES)) {
  out[pname] = {};
  for (const [sname, path] of Object.entries(sources)) {
    const raw = fs.readFileSync(path, 'utf8');
    const check = (ctx) => {
      const w = windowWith(raw, ctx, 6000, pol);
      const markers = sname === 'tavilyBasicMd' ? BASIC_MARKERS : ESSENTIAL;
      return { pass: markers.every((m) => w.content.includes(m)), optional: OPTIONAL.filter((m) => w.content.includes(m)).length, excerpts: w.excerpts.map((e) => e.join('-')) };
    };
    const obs = observed.map((c) => ({ label: c.label, ...check(c) }));
    const cross = ctxs.map((c) => ({ label: c.label, ...check(c) }));
    // Snippet sensitivity: for each query, do all snippet variants yield the same excerpts?
    const perQuery = new Map();
    for (const c of cross) { const k = c.label.split(' s=')[0]; if (!perQuery.has(k)) perQuery.set(k, new Set()); perQuery.get(k).add(c.excerpts.join(',')); }
    out[pname][sname] = {
      observedPass: `${obs.filter((o) => o.pass).length}/${obs.length}`,
      crossPass: `${cross.filter((o) => o.pass).length}/${cross.length}`,
      crossOptionalFull: `${cross.filter((o) => o.optional === 2).length}/${cross.length}`,
      queriesWithSnippetIndependentWindow: `${[...perQuery.values()].filter((s) => s.size === 1).length}/${perQuery.size}`,
      ...(mode === 'full' ? { obs, cross } : { failingCross: cross.filter((o) => !o.pass).map((o) => o.label) }),
    };
  }
}
console.log(JSON.stringify({ distinctQueries: queries.size, distinctSnippets: snippets.size, observedContexts: observed.length, results: out }, null, 1));
