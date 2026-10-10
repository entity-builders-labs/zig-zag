// Final PF COLD/WARM: identity-decision audit (read-only, no provider calls).
// Lists every component/entity identity decision and flags any VERIFIED
// decision whose decisive evidence is an IDENTITY_CONVERGENCE that is not
// EQUIVALENT / CORROBORATING (RW4-ID-FALSE-VERIFY-2 class).
//
//   node identity-audit.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const trace = JSON.parse(
  fs.readFileSync(path.join(path.resolve(process.argv[2]), 'generation-trace.json'), 'utf8'),
);
const decisions = [];
const visit = (stepId, stepName, node) => {
  if (Array.isArray(node)) return node.forEach((n) => visit(stepId, stepName, n));
  if (!node || typeof node !== 'object') return;
  if (node.identityDecision && (node.name || node.hint || node.sourceName)) {
    const d = node.identityDecision;
    const evidence = [...(d.evidence ?? []), ...(d.decisiveEvidence ?? [])];
    const convergence = evidence.filter((e) => e.type === 'IDENTITY_CONVERGENCE');
    decisions.push({
      step: stepId,
      stepName,
      name: node.name ?? node.hint ?? node.sourceName,
      verdict: node.identityVerdict ?? d.verdict,
      rule: d.rule,
      finalStatus: node.finalStatus,
      finalReason: node.finalReason,
      selectedCandidate: node.selectedCandidate?.name,
      decisiveTypes: (d.decisiveEvidence ?? []).map((e) => `${e.type}/${e.role}`),
      convergence: convergence.map((e) => ({ role: e.role, correspondence: e.correspondence })),
    });
  }
  for (const k of Object.keys(node)) visit(stepId, stepName, node[k]);
};
for (const s of trace.steps) {
  if (/^resolution\./.test(s.name)) visit(s.id, s.name, s.facts);
}
const flagged = decisions.filter(
  (d) =>
    d.verdict === 'VERIFIED' &&
    (d.decisiveTypes.some((t) => t.startsWith('IDENTITY_CONVERGENCE') && !t.endsWith('/CORROBORATING')) ||
      d.convergence.some((c) => c.correspondence && c.correspondence !== 'EQUIVALENT' && c.role === 'CORROBORATING')),
);
const byKey = (f) => decisions.reduce((a, d) => ((a[f(d)] = (a[f(d)] || 0) + 1), a), {});
const convergenceSeen = decisions.flatMap((d) => d.convergence.map((c) => `${d.verdict}|${c.correspondence}|${c.role}`));
console.log(
  JSON.stringify(
    {
      decisionCount: decisions.length,
      verdictByRule: byKey((d) => `${d.verdict}|${d.rule}`),
      convergenceEvidence: convergenceSeen.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {}),
      overlapOrNonePromotedToVerified: flagged,
      decisions,
    },
    null,
    1,
  ),
);
