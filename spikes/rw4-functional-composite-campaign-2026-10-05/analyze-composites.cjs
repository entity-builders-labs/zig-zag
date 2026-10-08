// Partial-composite C3: composite outcome, dedupe evidence and Tour use of
// every multi-member candidate in a run's generation trace.
// Read-only; no provider calls.
//   node analyze-composites.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2]);
const trace = JSON.parse(
  fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'),
);
const steps = trace.steps;

const out = {
  run: path.basename(dir),
  buildCommit: trace.runtime?.buildCommit,
  composites: [],
  componentIdentity: [],
  selection: {},
  tour: null,
};

for (const step of steps.filter((s) => s.name === 'catalog.materialization')) {
  for (const audit of step.facts?.materializationAudit ?? []) {
    const total = audit.compositeOutcome?.coverage?.totalComponents;
    if (!(total > 1)) continue;
    out.composites.push({
      pass: step.parentId,
      candidateName: audit.candidateName,
      accepted: audit.accepted,
      experienceId: audit.experienceId,
      canonicalName: audit.canonicalName,
      persistedComponentCount: audit.persistedComponentCount,
      rejectionReasons: audit.rejectionReasons,
      compositeOutcome: audit.compositeOutcome,
    });
  }
}

for (const step of steps.filter(
  (s) => s.name === 'resolution.component_identity',
)) {
  out.componentIdentity.push({
    pass: step.parentId,
    description: step.description,
    decision: step.decision,
    components: (step.subjects ?? []).map((subject) => ({
      name: subject.subject?.name ?? subject.subject?.id,
      outcome: subject.decision?.outcome,
      reason: subject.decision?.reason,
      deficit: subject.facts?.deficitReason ?? subject.facts?.deficit,
      rule: subject.facts?.verificationRule ?? subject.facts?.identityDecision?.rule,
    })),
  });
}

for (const name of ['candidate_pool.selection', 'ranking.semantic', 'planning.daily']) {
  const step = steps.find((s) => s.name === name);
  if (step) {
    out.selection[name] = {
      decision: step.decision,
      description: step.description,
      facts: step.facts,
    };
  }
}
const tour = steps.find((s) => s.name === 'tour.materialization');
out.tour = tour ? { decision: tour.decision, facts: tour.facts } : null;

console.log(JSON.stringify(out, null, 2));
