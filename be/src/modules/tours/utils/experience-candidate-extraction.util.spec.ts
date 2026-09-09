import { extractExperienceCandidates } from './experience-candidate-extraction.util';

describe('extractExperienceCandidates', () => {
  it('accepts evidence-backed candidates without structural kinds', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Costanera cultural',
            themes: ['culture'],
            traits: [],
            intents: ['walk'],
            componentHints: [
              {
                key: 'route',
                name: 'Costanera Norte',
                role: 'route',
                expectedKind: 'ROUTE',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'Evidence-backed route',
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ intents: ['walk'] });
    expect(result.candidates[0]).not.toHaveProperty('kind');
  });

  it('defaults orderedByEvidence to false when the raw candidate omits it', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Unordered walk',
            themes: ['culture'],
            traits: [],
            intents: ['walk'],
            componentHints: [
              {
                key: 'a',
                name: 'Plaza',
                role: 'waypoint',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'no sequence claim',
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates[0].orderedByEvidence).toBe(false);
  });

  it('carries orderedByEvidence through only when the raw candidate explicitly sets it true', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Ordered walk',
            themes: ['culture'],
            traits: [],
            intents: ['walk'],
            componentHints: [
              {
                key: 'a',
                name: 'Plaza',
                role: 'waypoint',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'evidence describes start-then-walk sequence',
            orderedByEvidence: true,
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates[0].orderedByEvidence).toBe(true);
  });

  it('repairs leaked/localized semantic facets on the returned candidate', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Palermo craft beer crawl',
            themes: ['gastronomía'],
            // canonical themes/intents the model wrongly dropped into traits,
            // plus one genuine long-tail trait
            traits: ['history', 'Architecture', 'walk', 'Craft Beer'],
            intents: ['route-like'],
            componentHints: [
              {
                key: 'a',
                name: 'Bar',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'evidence-backed crawl',
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      themes: ['gastronomy', 'history', 'architecture'],
      intents: ['route_like', 'walk'],
      traits: ['Craft Beer'],
    });
  });

  it('rejects unknown evidence and malformed components', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Invented',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                name: 'Unknown',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-9'],
              },
            ],
            evidenceKeys: ['ev-9'],
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(
      /unknown evidence|invalid evidence/,
    );
  });
});
