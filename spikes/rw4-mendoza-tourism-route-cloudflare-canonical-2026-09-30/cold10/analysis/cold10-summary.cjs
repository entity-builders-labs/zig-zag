// Deterministic summary of COLD #10 from its committed generation trace.
// Run from the repo root.
const fs = require('fs');
const dir = 'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/cold10/';
const t = JSON.parse(fs.readFileSync(dir + 'generation-trace.json', 'utf8'));
const NAMES = ['Alfa Crux', 'SuperUco', 'Bodega Azul', 'Corazon del Sol', 'Solo Contigo'];
const passes = {};
for (const s of t.steps) {
  const pass = s.parentId || '';
  const p = (passes[pass] ??= { windows: [] });
  if (s.name === 'acquisition.source_retrieval') {
    p.trigger = s.facts.triggerReason;
    p.retrievedUrls = s.facts.retrievedUrls;
    p.failedUrls = (s.facts.items || []).filter((i) => i.status === 'failed').map((i) => ({ url: i.requestedUrl, reason: i.failureReason }));
    p.sources = (s.facts.items || []).filter((i) => i.windowSequence).map((i) => ({ url: i.requestedUrl, contentChars: i.contentChars, chunkCount: i.windowSequence[0].chunkCount, windowCount: i.windowSequence.length }));
    p.scan = s.facts.scan;
  }
  if (s.name === 'acquisition.deep_source_window') {
    const f = s.facts;
    p.windows.push({
      sourceUrl: f.sourceUrl, ordinal: f.windowing.windowOrdinal, windowCount: f.windowing.windowCount,
      strategy: f.windowing.selectionStrategy, retainedChars: f.windowing.retainedContentChars,
      excerpts: f.windowing.selectedExcerpts.map((e) => `${e.start}-${e.end}`),
      extracted: f.extractedCandidateCount, admitted: f.admittedCandidateCount,
      validationErrors: f.validationErrors, scanDecision: s.decision.outcome,
      ucoNamesInWindow: NAMES.filter((n) => f.content.toLowerCase().includes(n.toLowerCase())),
    });
  }
  if (s.name === 'catalog.materialization') {
    p.uco = (s.facts.materializationAudit || []).filter((a) => /Uco|Luj/.test(a.candidateName));
  }
  if (s.name === 'resolution.entity') {
    p.resolutionSubjects = (s.subjects || []).filter((x) => /Uco|Luj/.test(x.subject.label || '')).map((x) => ({ label: x.subject.label, decision: x.decision }));
    p.resolutionFactsTruncated = Boolean(s.facts && s.facts.truncated);
  }
  if (s.name === 'geography.validation') p.validationIntent = s.facts.validationIntent;
}
const out = Object.fromEntries(Object.entries(passes).filter(([, v]) => v.windows.length || v.uco));
fs.writeFileSync(dir + 'analysis/cold10-summary.out.json', JSON.stringify({ buildCommit: t.runtime && t.runtime.buildCommit, passes: out }, null, 2) + '\n');
console.log('written');
