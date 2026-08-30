import {
  validateProposal,
  validateKindRules,
} from 'src/modules/tours/utils/discovery-extraction-shared.util';

describe('Provider Contract: Groq Grounded Discovery Proposals (TC-PROV-02)', () => {
  const validEvidenceKeys = ['ev-1', 'ev-2'];

  it('validates compliant Groq proposal schema with required entity hints', () => {
    const validProposal = {
      name: 'Teatro Colón Visita Guiada',
      kind: 'POI',
      themes: ['architecture', 'culture'],
      suggestedDurationMinutes: 90,
      shortReason: 'Ícono lírico y arquitectónico',
      evidenceKeys: ['ev-2'],
      entityHints: [
        {
          key: 'hint-1',
          name: 'Teatro Colón',
          role: 'venue',
          expectedType: 'theater',
          required: true,
          evidenceKeys: ['ev-2'],
        },
      ],
    };

    const errors = validateProposal(validProposal, validEvidenceKeys);
    expect(errors).toHaveLength(0);

    const kindErrors = validateKindRules(validProposal.kind as any, validProposal.entityHints);
    expect(kindErrors).toHaveLength(0);
  });

  it('rejects proposal with invalid kind or missing entity hints', () => {
    const invalidProposal = {
      name: 'Actividad Sin Entidades',
      kind: 'INVALID_KIND',
      themes: ['culture'],
      suggestedDurationMinutes: 60,
      shortReason: 'Sin entidades',
      evidenceKeys: ['ev-1'],
      entityHints: [] as any[],
    };

    const errors = validateProposal(invalidProposal, validEvidenceKeys);
    expect(errors.some((e) => e.includes('invalid kind'))).toBe(true);
    expect(errors.some((e) => e.includes('missing entityHints'))).toBe(true);
  });
});
