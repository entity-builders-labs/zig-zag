// C3 after milestone B: summarize every atomized source unit in a run's
// generation trace (pre-identity fidelity) and the downstream outcome of
// the candidates it produced. Read-only; no provider calls.
//   node analyze-atomized.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2]);
const trace = JSON.parse(fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'));
const steps = trace.steps;
const byId = new Map(steps.map((s) => [s.id, s]));

const out = { run: path.basename(dir), buildCommit: trace.runtime?.buildCommit, windows: [], units: [], resolution: [] };

for (const s of steps.filter((x) => x.name === 'acquisition.deep_source_window')) {
  const f = s.facts;
  out.windows.push({
    pass: s.parentId,
    sourceUrl: f.sourceUrl,
    inputKind: f.inputKind,
    strategy: f.windowing?.selectionStrategy,
    sectionComplete: f.windowing?.sectionComplete,
    windowOrdinal: f.windowing?.windowOrdinal,
    chars: f.windowing?.retainedContentChars,
    decision: s.decision?.outcome,
    extracted: f.extractedCandidateCount,
    admitted: f.admittedCandidateCount,
    failureReason: f.failureReason,
  });
}

for (const s of steps.filter((x) => x.name === 'acquisition.atomized_source_unit')) {
  const f = s.facts;
  out.units.push({
    pass: s.parentId,
    sourceUnitId: f.sourceUnitId,
    sourceUrl: f.sourceUrl,
    outcome: f.contractOutcome,
    atoms: `${f.atomCount} (${f.nonEditorialAtomCount} non-editorial)`,
    nonEditorialBlocks: (f.nonEditorialBlocks || []).map((b) => `${b.firstAtomId}..${b.lastAtomId}`),
    batches: f.batchCount,
    calls: (f.calls || []).map((c) => `${c.kind}#${c.batchIndex}:${c.atomCount}a/${c.promptChars}c/${c.elapsedMs}ms`),
    relabel: f.relabel ? { scope: f.relabel.scope, firstPassIssues: (f.relabel.firstPassIssues || []).map((x) => `${x.code}:${x.atomId ?? ''}`) } : null,
    issues: (f.issues || []).map((x) => `${x.code}:${x.atomId ?? ''}`),
    memberKindIssues: f.memberKindIssues,
    providerFailure: f.providerFailure,
    segments: (f.segments || []).map((g) => ({
      segmentIndex: g.segmentIndex,
      range: `${g.firstAtomId}..${g.lastAtomId}`,
      openedBy: (g.transferBoundary || []).map((o) => `${o.atomId}:${o.transferMode}`),
      transferDestinations: (g.transferDestinations || []).map((d) => `${d.sourceName}@${d.atomId}`),
      mandatoryBeforeIdentity: (g.mandatoryBeforeIdentity || []).map((m) => `${m.sourceName} [${m.physicalKind ?? '?'}] @${m.provenanceAtomIds.join(',')}`),
      optional: g.optional,
      alternativeGroups: g.alternativeGroups,
      routeLegs: g.routeLegs,
      passBy: g.passBy,
      conflicts: g.conflicts,
      candidateName: g.candidateName,
    })),
    candidateNames: f.candidateNames,
  });
}

// Downstream: per-candidate component identity of atomized candidates.
const names = new Set(out.units.flatMap((u) => u.candidateNames || []));
for (const s of steps.filter((x) => x.name === 'resolution.component_identity')) {
  const f = s.facts || {};
  const label = s.subjects?.[0]?.subject?.label ?? f.candidateName ?? s.description;
  if (![...names].some((n) => String(label).includes(n) || String(s.description).includes(n))) continue;
  out.resolution.push({ pass: s.parentId, description: s.description, decision: s.decision, facts: f });
}
for (const s of steps.filter((x) => x.name === 'catalog.materialization' || x.name === 'resolution.entity')) {
  for (const sub of s.subjects || []) {
    if ([...names].includes(sub.subject?.label))
      out.resolution.push({ pass: s.parentId, step: s.name, candidate: sub.subject.label, decision: sub.decision, facts: sub.facts });
  }
}
console.log(JSON.stringify(out, null, 1));
void byId;
