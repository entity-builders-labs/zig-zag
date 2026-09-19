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

  it('carries a componentHint addressHint through when the raw hint sets a non-empty string', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Recoleta Cemetery Visit',
            themes: ['history'],
            traits: [],
            intents: ['visit'],
            componentHints: [
              {
                key: 'cemetery',
                name: 'Recoleta Cemetery',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-1'],
                addressHint: 'Junín 1760',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates[0].componentHints[0].addressHint).toBe(
      'Junín 1760',
    );
  });

  it('omits addressHint when the raw hint does not set one (regression guard: field must stay optional/absent, never an empty string)', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Teatro Colón Visit',
            themes: ['culture'],
            traits: [],
            intents: ['visit'],
            componentHints: [
              {
                key: 'theatre',
                name: 'Teatro Colón',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates[0].componentHints[0]).not.toHaveProperty(
      'addressHint',
    );
  });

  it('recovers a candidate when the provider returns a bare object instead of {candidates:[...]} (real Groq JSON-object-mode drift, never silent)', () => {
    // Reproduces the exact raw shape observed live from Groq
    // (qwen/qwen3.8-27b, json_object mode, no enforced schema): a single
    // candidate object with no top-level "candidates" wrapper.
    const bareCandidateObject = {
      name: 'San Telmo Colonial Walking Tour',
      description: 'A guided walking tour through the oldest neighborhood.',
      themes: ['history', 'culture'],
      traits: ['guided walking tour'],
      intents: ['walk'],
      suggestedDurationMinutes: 120,
      componentHints: [
        {
          key: 'san-telmo-market',
          name: 'San Telmo Market',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-10'],
        },
        {
          key: 'lezama-park',
          name: 'Lezama Park',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-10'],
        },
      ],
      evidenceKeys: ['ev-10'],
      shortReason:
        "Evidence explicitly describes a specific walking tour named 'San Telmo Colonial Walking Tour'.",
      orderedByEvidence: false,
    };

    const result = extractExperienceCandidates(
      bareCandidateObject,
      new Set(['ev-10']),
      8,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('San Telmo Colonial Walking Tour');
    expect(result.candidates[0].componentHints).toHaveLength(2);
    // Never silent: the repair must be observable downstream (it already
    // flows into WebAcquisitionResult.validationErrors / the generation
    // trace unchanged, no new plumbing needed).
    expect(result.validationErrors).toEqual([
      expect.stringContaining('extractor_envelope_repaired'),
    ]);
  });

  it('does not repair a raw value that is neither an array, a {candidates:[...]} envelope, nor a single-candidate-shaped object', () => {
    const result = extractExperienceCandidates(
      { unrelated: 'shape', foo: 'bar' },
      new Set(['ev-1']),
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toEqual([]);
  });
});
