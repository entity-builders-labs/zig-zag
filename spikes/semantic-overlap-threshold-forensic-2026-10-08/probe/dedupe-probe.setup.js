// Read-only probe: wraps decideExperienceDedupe to log real inputs/evidence/decisions.
const UTIL = '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/utils/experience-dedupe.util';
const OUT = process.env.DEDUPE_PROBE_OUT;
jest.mock(UTIL, () => {
  const actual = jest.requireActual(UTIL);
  const fs = require('fs');
  return {
    ...actual,
    decideExperienceDedupe: (incoming, existing) => {
      const decision = actual.decideExperienceDedupe(incoming, existing);
      try {
        const st = expect.getState();
        const perCandidate = existing.filter((c) => !!c.id).map((c) => ({
          id: c.id,
          canonicalName: c.canonicalName,
          componentCount: (c.components || []).length,
          evidence: actual.compareFingerprints(incoming, c),
          fp: c,
        }));
        fs.appendFileSync(OUT, JSON.stringify({
          file: (st.testPath || '').split('/be/')[1],
          test: st.currentTestName,
          incoming,
          perCandidate,
          decision: decision.decision,
          reasons: decision.evidence.reasons,
        }) + '\n');
      } catch (e) { /* probe must never affect behavior */ }
      return decision;
    },
  };
});
