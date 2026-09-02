import { extractExperienceCandidates } from './experience-candidate-extraction.util';

describe('extractExperienceCandidates', () => {
  it('accepts evidence-backed candidates without structural kinds', () => {
    const result = extractExperienceCandidates({ candidates: [{ name: 'Costanera cultural', themes: ['culture'], traits: [], componentHints: [{ key: 'route', name: 'Costanera Norte', role: 'route', expectedKind: 'ROUTE', required: true, evidenceKeys: ['ev-1'] }], evidenceKeys: ['ev-1'], shortReason: 'Evidence-backed route' }] }, new Set(['ev-1']), 8);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).not.toHaveProperty('kind');
  });

  it('rejects unknown evidence and malformed components', () => {
    const result = extractExperienceCandidates({ candidates: [{ name: 'Invented', themes: [], traits: [], componentHints: [{ name: 'Unknown', role: 'venue', expectedKind: 'PLACE', required: true, evidenceKeys: ['ev-9'] }], evidenceKeys: ['ev-9'] }] }, new Set(['ev-1']), 8);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(/unknown evidence|invalid evidence/);
  });
});
