import {
  validateProposal,
  validateKindRules,
} from 'src/modules/tours/utils/discovery-extraction-shared.util';

describe('Provider Contract: Gemini Discovery Proposals (TC-PROV-01)', () => {
  const validEvidenceKeys = ['ev-1', 'ev-2', 'ev-3'];

  it('validates compliant Gemini proposal schema with valid evidence keys', () => {
    const validProposal = {
      name: 'Paseo Histórico San Telmo',
      kind: 'NEIGHBORHOOD_WALK',
      themes: ['history', 'architecture'],
      suggestedDurationMinutes: 120,
      shortReason: 'Recorrido histórico por el casco antiguo',
      evidenceKeys: ['ev-1'],
      entityHints: [
        {
          key: 'hint-area',
          name: 'Barrio San Telmo',
          role: 'area',
          expectedType: 'neighborhood',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'hint-1',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          expectedType: 'square',
          required: false,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'hint-2',
          name: 'Mercado de San Telmo',
          role: 'waypoint',
          expectedType: 'market',
          required: false,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const errors = validateProposal(validProposal, validEvidenceKeys);
    expect(errors).toHaveLength(0);

    const kindErrors = validateKindRules(validProposal.kind as any, validProposal.entityHints);
    expect(kindErrors).toHaveLength(0);
  });

  it('rejects proposal with hallucinated evidence keys', () => {
    const invalidProposal = {
      name: 'Paseo Falso',
      kind: 'POI',
      themes: ['history'],
      suggestedDurationMinutes: 60,
      shortReason: 'Inventado',
      evidenceKeys: ['ev-999'], // Hallucinated key
      entityHints: [
        {
          key: 'hint-1',
          name: 'Lugar Fantasma',
          role: 'venue',
          expectedType: 'museum',
          required: true,
          evidenceKeys: ['ev-999'],
        },
      ],
    };

    const errors = validateProposal(invalidProposal, validEvidenceKeys);
    expect(errors.some((e) => e.includes('unknown evidence key'))).toBe(true);
  });
});
