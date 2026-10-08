// Read-only simulation of the proposed PARTIAL acceptance rule over a run's
// identity-analysis.json. Deficit derivation mirrors componentDeficitReason.
'use strict';
const fs = require('fs');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const overrides = JSON.parse(process.argv[3] || '{}'); // name -> {status, verdict}
const CLASS = {
  NO_CANDIDATE_ACQUIRED: 'MISSING_KNOWLEDGE',
  CANDIDATE_UNCONFIRMED: 'MISSING_KNOWLEDGE',
  AMBIGUOUS_CANDIDATES: 'MISSING_KNOWLEDGE',
  CANDIDATE_REJECTED: 'MISSING_KNOWLEDGE', // candidate disproven, not the source member
  IDENTITY_CONFLICT: 'CONTRADICTORY_EVIDENCE',
  DESTINATION_INCOMPATIBLE: 'CONTRADICTORY_EVIDENCE',
  DESTINATION_COMPATIBILITY_UNKNOWN: 'UNKNOWN',
  PROVIDER_FAILURE: 'SYSTEM_FAILURE',
};
function deficit(c) {
  if (c.finalReason === 'IDENTITY_CONFLICT') return 'IDENTITY_CONFLICT';
  const verdicts = (c.attempts || []).filter((x) => x.acquired).map((x) => x.decision).filter(Boolean);
  if (c.finalReason === 'AMBIGUOUS' || (c.attempts || []).some((x) => x.decision === 'AMBIGUOUS') || c.verdict === 'AMBIGUOUS') return 'AMBIGUOUS_CANDIDATES';
  if (c.finalReason === 'DESTINATION_INCOMPATIBLE') return 'DESTINATION_INCOMPATIBLE';
  if (c.finalReason === 'DESTINATION_COMPATIBILITY_UNKNOWN') return 'DESTINATION_COMPATIBILITY_UNKNOWN';
  if (verdicts.length && verdicts.every((v) => v === 'REJECTED')) return 'CANDIDATE_REJECTED';
  if ((c.attempts || []).some((x) => x.acquired)) return 'CANDIDATE_UNCONFIRMED';
  if (c.finalReason === 'OSM_PROVIDER_FAILED' || (c.attempts || []).some((x) => x.status === 'failed')) return 'PROVIDER_FAILURE';
  return 'NO_CANDIDATE_ACQUIRED';
}
for (const step of a.identity) {
  const name = step.description.match(/"(.*)"/)[1];
  const comps = step.components.map((c) => {
    const o = overrides[c.name];
    if (o) return { ...c, finalStatus: o.status, verdict: o.verdict, finalReason: o.status === 'resolved' ? undefined : 'UNCONFIRMED_MATCH', attempts: o.status === 'resolved' ? c.attempts : [{ acquired: true, decision: o.verdict }] };
    return c;
  });
  const resolved = comps.filter((c) => c.finalStatus === 'resolved');
  const distinct = new Set(resolved.map((c) => (c.selected ? `${c.selected.name}@${c.selected.latitude},${c.selected.longitude}` : c.name)));
  const unresolved = comps.filter((c) => c.finalStatus !== 'resolved').map((c) => ({ name: c.name, role: c.role, d: deficit(c) }));
  const ineligible = unresolved.filter((u) => CLASS[u.d] !== 'MISSING_KNOWLEDGE');
  const scopeUnresolved = unresolved.filter((u) => u.role === 'area' || u.role === 'route');
  const floor = distinct.size >= 2;
  const verdict = unresolved.length === 0 ? 'COMPLETE (unchanged path)' : !floor ? 'REJECT (below floor)' : ineligible.length ? 'REJECT (ineligible deficit)' : 'PARTIAL -> geographic validation';
  console.log(`\n## ${step.parent.replace('acquisition-pass-1-', '')} | ${name}`);
  console.log(`   source=${comps.length} resolved=${resolved.length} distinct=${distinct.size} [${[...distinct].join('; ')}]`);
  const tally = {}; for (const u of unresolved) tally[u.d] = (tally[u.d] || 0) + 1;
  console.log(`   unresolved=${unresolved.length} ${JSON.stringify(tally)}  scope-role unresolved: ${scopeUnresolved.map((u) => u.name + '(' + u.role + ')').join(', ') || '-'}`);
  console.log(`   => ${verdict}`);
}
