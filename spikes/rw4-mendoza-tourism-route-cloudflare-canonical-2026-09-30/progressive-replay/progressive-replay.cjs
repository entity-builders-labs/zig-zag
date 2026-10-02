// Offline replay of the PRODUCTION progressive window sequence
// (windowSourceContentSequence, be/dist) over the committed SolSalute
// Cloudflare rendering, with the exact COLD #7 and COLD #9 relevance inputs.
// Run from the repo root after `yarn build` in be/.
const fs = require('fs');
const { windowSourceContentSequence, SOURCE_EXCERPT_SEPARATOR } = require(process.cwd() + '/be/dist/src/modules/tours/utils/source-content-windowing.util.js');
const { DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS } = require(process.cwd() + '/be/dist/src/modules/tours/interfaces/web-source-content.interface.js');
const content = fs.readFileSync('spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md', 'utf8');
const base = 'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/';
const MANDATORY = ['Alfa Crux', 'SuperUco', 'Bodega Azul'];
const OPTIONAL = ['Corazon del Sol', 'Solo Contigo'];
const has = (text, n) => new RegExp(n, 'i').test(text);
function inputs(dir) {
  const t = JSON.parse(fs.readFileSync(base + dir + '/generation-trace.json', 'utf8'));
  const ws = t.steps.find((s) => s.name === 'acquisition.web_search' && /generic/.test(s.parentId || ''));
  const ev = ws.facts.groundedEvidence.filter((e) => /solsalute/.test(e.url));
  return { titles: ev.map((e) => e.title).filter(Boolean), snippets: ev.map((e) => e.snippet).filter(Boolean), queries: [ws.facts.query, ws.facts.semanticQuery].filter(Boolean) };
}
function run(label, ctx) {
  const windows = windowSourceContentSequence(content, ctx, DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS);
  const rows = windows.map((w) => {
    const excerpts = w.content.split(SOURCE_EXCERPT_SEPARATOR);
    return {
      ordinal: w.audit.windowOrdinal,
      strategy: w.audit.selectionStrategy,
      retainedChars: w.audit.retainedContentChars,
      newChunks: w.audit.newChunkCount,
      overlapChunks: w.audit.overlapChunkCount,
      unexaminedAfter: w.audit.unexaminedChunkCountAfter,
      excerpts: w.audit.selectedExcerpts.map((e) => `${e.start}-${e.end}`),
      mandatoryInWindow: MANDATORY.filter((n) => has(w.content, n)),
      optionalInWindow: OPTIONAL.filter((n) => has(w.content, n)),
      mandatoryInOneExcerpt: excerpts.some((e) => MANDATORY.every((n) => has(e, n))),
    };
  });
  const first = rows.find((r) => r.mandatoryInWindow.length === MANDATORY.length);
  const summary = {
    label,
    totalWindows: windows.length,
    chunkCount: windows[0].audit.chunkCount,
    maxRetainedChars: Math.max(...rows.map((r) => r.retainedChars)),
    allChunksExamined: rows[rows.length - 1].unexaminedAfter === 0,
    firstWindowWithFullMandatoryComposition: first ? first.ordinal : null,
    mandatoryInOneExcerpt: first ? first.mandatoryInOneExcerpt : null,
    optionalAlsoInThatWindow: first ? first.optionalInWindow : null,
  };
  return { summary, windows: rows };
}
const c7 = inputs('cold_prev_13933cc7'), c9 = inputs('cold9');
const out = {
  source: { file: 'spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md', chars: content.length, maxChars: DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS },
  runs: [
    run('COLD7 inputs', c7),
    run('COLD9 inputs', c9),
    run('COLD9 query + COLD7 snippet', { ...c9, snippets: c7.snippets }),
    run('COLD7 query + COLD9 snippet', { ...c7, snippets: c9.snippets }),
    run('stable title+query only (no snippet)', { ...c9, snippets: [] }),
  ],
};
fs.writeFileSync(base + 'progressive-replay/progressive-replay.out.json', JSON.stringify(out, null, 2) + '\n');
for (const r of out.runs) console.log(JSON.stringify(r.summary));
