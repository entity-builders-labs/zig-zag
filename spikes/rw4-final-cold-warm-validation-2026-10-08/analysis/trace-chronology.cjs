// RW4 FINAL COLD/WARM: trace chronology of the GATHER → RECONCILE → FREEZE →
// PLAN boundary, plus composite materialization, reconciliation and duration
// provenance. Read-only; no provider calls.
//
//   node trace-chronology.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2]);
const trace = JSON.parse(
  fs.readFileSync(path.join(dir, 'generation-trace.json'), 'utf8'),
);
const steps = trace.steps || [];

const out = {
  run: path.basename(dir),
  buildCommit: trace.runtime?.buildCommit,
  stepCount: steps.length,
  // Full ordered step timeline (id, name, parent, outcome, one-line description).
  timeline: steps.map((s) => ({
    id: s.id,
    name: s.name,
    parent: s.parentId ?? null,
    outcome: s.decision?.outcome ?? null,
    description: (s.description ?? '').slice(0, 220),
  })),
  snapshots: [],
  gathers: [],
  provisionals: [],
  finalSelection: null,
  materializations: [],
  tour: null,
  componentIdentity: [],
};

for (const s of steps.filter((x) => x.name === 'catalog.snapshot')) {
  out.snapshots.push({
    id: s.id,
    description: s.description,
    phase: s.facts?.phase,
    acquisitionEpoch: s.facts?.acquisitionEpoch,
    eligibleCount: s.facts?.eligibleCount,
    compositeCount: s.facts?.compositeCount,
    eligibleExperienceIds: s.facts?.eligibleExperienceIds ?? [],
    composites: (s.subjects ?? []).map((sub) => ({
      label: sub.subject?.label,
      id: sub.subject?.id,
      facts: sub.facts,
    })),
  });
}

for (const s of steps.filter((x) => x.name === 'generation.gather')) {
  out.gathers.push({
    id: s.id,
    boundary: s.facts?.boundary,
    description: s.description,
    acquisitionEpoch: s.facts?.acquisitionEpoch,
    newCount: s.facts?.newCount,
    sameCount: s.facts?.sameCount,
    ambiguousCount: s.facts?.ambiguousCount,
    rejectedCount: s.facts?.rejectedCount,
    enrichedCount: s.facts?.enrichedCount,
    affectedExperienceIds: s.facts?.affectedExperienceIds ?? [],
    executions: (s.subjects ?? []).map((sub) => ({
      label: sub.subject?.label,
      facts: sub.facts,
    })),
  });
}

for (const s of steps.filter((x) => x.name === 'planning.provisional')) {
  out.provisionals.push({
    id: s.id,
    description: s.description,
    outcome: s.decision?.outcome,
    facts: s.facts,
  });
}

{
  const s = steps.find((x) => x.name === 'selection.final');
  if (s) {
    out.finalSelection = {
      id: s.id,
      description: s.description,
      outcome: s.decision?.outcome,
      facts: s.facts,
      subjects: (s.subjects ?? []).map((sub) => ({
        label: sub.subject?.label,
        id: sub.subject?.id,
        decision: sub.decision,
        facts: sub.facts,
      })),
    };
  }
}

for (const s of steps.filter((x) => x.name === 'catalog.materialization')) {
  for (const audit of s.facts?.materializationAudit ?? []) {
    out.materializations.push({
      pass: s.parentId,
      candidateName: audit.candidateName,
      accepted: audit.accepted,
      experienceId: audit.experienceId,
      canonicalName: audit.canonicalName,
      persistedComponentCount: audit.persistedComponentCount,
      rejectionReasons: audit.rejectionReasons,
      dedupe: audit.compositeOutcome?.dedupe ?? audit.compositeOutcome?.coverage,
      sourceCompositionRelation:
        audit.compositeOutcome?.dedupe?.sourceCompositionRelation ??
        audit.compositeOutcome?.sourceCompositionRelation ??
        null,
      sourceRelation:
        audit.compositeOutcome?.dedupe?.sourceRelation ?? null,
      reconciliation: audit.sourceKnowledgeReconciliation ?? null,
      durationMinutes: audit.durationMinutes ?? null,
      durationSource: audit.durationSource ?? null,
    });
  }
}

{
  const s = steps.find((x) => x.name === 'tour.materialization');
  if (s) out.tour = { id: s.id, decision: s.decision, facts: s.facts };
}

for (const s of steps.filter((x) => x.name === 'resolution.component_identity')) {
  out.componentIdentity.push({
    pass: s.parentId,
    description: s.description,
    decision: s.decision,
    components: (s.subjects ?? []).map((sub) => ({
      name: sub.subject?.name ?? sub.subject?.id,
      outcome: sub.decision?.outcome,
      reason: sub.decision?.reason,
      deficit: sub.facts?.deficitReason ?? sub.facts?.deficit,
      rule: sub.facts?.verificationRule ?? sub.facts?.identityDecision?.rule,
    })),
  });
}

// Chronology proof: list every acquisition epoch boundary in order.
out.epochChronology = steps
  .filter((s) =>
    ['catalog.snapshot', 'generation.gather', 'planning.provisional', 'selection.final'].includes(s.name),
  )
  .map((s) => ({
    name: s.name,
    id: s.id,
    phase: s.facts?.phase ?? s.facts?.boundary ?? s.decision?.outcome ?? null,
    acquisitionEpoch: s.facts?.acquisitionEpoch ?? null,
  }));

console.log(JSON.stringify(out, null, 2));
