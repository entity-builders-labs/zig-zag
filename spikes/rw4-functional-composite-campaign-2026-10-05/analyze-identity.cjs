// C3 identity retry: per-component identity outcome of every composite
// candidate in a run's generation trace, plus the composition, geography
// and materialization verdicts of the proposal it belonged to.
// Read-only; no provider calls.
//   node analyze-identity.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2]);
const trace = JSON.parse(fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'));
const steps = trace.steps;

const out = { run: path.basename(dir), buildCommit: trace.runtime?.buildCommit, plans: [], identity: [], entity: [], geography: [], materialization: [] };

for (const s of steps.filter((x) => x.name === 'acquisition.plan' || x.name === 'acquisition.deep_source_selection')) {
  out.plans.push({ step: s.name, id: s.id, parent: s.parentId, decision: s.decision, facts: s.facts?.scan ?? s.facts });
}

for (const s of steps.filter((x) => x.name === 'resolution.component_identity')) {
  out.identity.push({
    step: s.id,
    parent: s.parentId,
    description: s.description,
    decision: s.decision,
    components: (s.facts?.components || []).map((c) => ({
      name: c.name,
      role: c.role,
      expectedKind: c.expectedKind,
      verdict: c.identityVerdict ?? null,
      rule: c.identityRule ?? null,
      finalStatus: c.finalStatus,
      finalReason: c.finalReason,
      selected: c.selectedCandidate ?? null,
      identityDecision: c.identityDecision ?? null,
      destinationCompatibility: c.destinationCompatibility ?? null,
      attempts: (c.attempts || []).map((a) => ({
        strategy: a.strategy,
        acquired: a.candidateAcquired,
        candidate: a.selectedCandidate?.name,
        decision: a.verificationDecision,
        rule: a.verificationRule,
        recordEquivalence: a.recordEquivalence,
        failureReason: a.failureReason,
      })),
    })),
  });
}

for (const [name, key] of [['resolution.entity', 'entity'], ['geography.validation', 'geography'], ['catalog.materialization', 'materialization']]) {
  for (const s of steps.filter((x) => x.name === name)) {
    out[key].push({
      step: s.id,
      parent: s.parentId,
      description: s.description,
      decision: s.decision,
      subjects: (s.subjects || []).map((sub) => ({ label: sub.subject?.label, kind: sub.subject?.kind, decision: sub.decision, facts: sub.facts })),
      facts: s.facts,
    });
  }
}
console.log(JSON.stringify(out, null, 1));
