import { extractExperienceCandidates } from 'src/modules/tours/utils/experience-candidate-extraction.util';

describe('Provider Contract: Groq ExperienceCandidate envelope', () => {
  it('accepts a venue-centric Experience with one PLACE component', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Visita guiada al Teatro Colón',
            description: 'Visita cultural sustentada por evidencia',
            themes: ['architecture', 'culture'],
            traits: ['guided'],
            intents: ['visit'],
            suggestedDurationMinutes: 90,
            shortReason: 'Ícono arquitectónico',
            evidenceKeys: ['ev-2'],
            componentHints: [
              {
                key: 'venue',
                name: 'Teatro Colón',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-2'],
                supportSpan: 'El Teatro Colón es un ícono arquitectónico',
              },
            ],
          },
        ],
      },
      [
        {
          key: 'ev-2',
          text: 'El Teatro Colón es un ícono arquitectónico de Buenos Aires.',
        },
      ],
      8,
    );
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates[0].componentHints).toHaveLength(1);
  });

  it('rejects invalid component kinds and missing required fields', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Sin entidades',
            themes: ['culture'],
            traits: [],
            evidenceKeys: ['ev-1'],
            componentHints: [
              {
                key: 'x',
                name: 'Lugar',
                role: 'venue',
                expectedKind: 'INVALID',
                evidenceKeys: ['ev-1'],
                supportSpan: 'el Lugar',
              },
            ],
          },
        ],
      },
      [{ key: 'ev-1', text: 'texto sobre el Lugar' }],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(
      /invalid role\/kind|suggestedDurationMinutes/,
    );
  });
});
