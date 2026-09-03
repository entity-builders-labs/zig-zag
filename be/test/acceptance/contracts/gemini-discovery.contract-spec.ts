import { extractExperienceCandidates } from 'src/modules/tours/utils/experience-candidate-extraction.util';

describe('Provider Contract: Gemini ExperienceCandidate envelope', () => {
  const evidence = new Set(['ev-1']);
  const valid = {
    candidates: [
      {
        name: 'Paseo Histórico San Telmo',
        description: 'Recorrido histórico por el casco antiguo',
        themes: ['history', 'architecture'],
        traits: ['walking', 'guided'],
        suggestedDurationMinutes: 120,
        shortReason: 'Sustentado por evidencia',
        evidenceKeys: ['ev-1'],
        componentHints: [
          {
            key: 'area',
            name: 'Barrio San Telmo',
            role: 'area',
            expectedKind: 'AREA',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      },
    ],
  };

  it('accepts the canonical schema without structural kinds', () => {
    const result = extractExperienceCandidates(valid, evidence, 8);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates[0]).not.toHaveProperty('kind');
    expect(result.candidates[0].componentHints[0].expectedKind).toBe('AREA');
  });

  it('rejects hallucinated evidence keys and legacy envelopes', () => {
    const result = extractExperienceCandidates(
      {
        proposals: [{ kind: 'POI', entityHints: [] }],
        candidates: [{ ...valid.candidates[0], evidenceKeys: ['ev-999'] }],
      },
      evidence,
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(/unknown evidence/);
  });
});
