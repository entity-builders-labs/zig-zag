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

  /**
   * Stage 1 characterization lock (component-resolution-and-partial-
   * composite-recovery-plan.md, Case G). Real RW1 fixture: cold-2 pass 1's
   * extractor emitted a "Basílica de Santa Mónica" componentHint citing
   * ev-11, whose actual captured snippet ("Commissioned by the Jesuits...
   * this church gave the neighborhood its modern name [St. Peter Gonzalez
   * Telmo]...") never names that basilica or an equivalent entity —
   * confirmed against
   * spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/cold-2/
   * web-extraction.json. The amendment (§2, §13) requires this to fail at
   * source-support admission, before geographic/provider acquisition ever
   * runs; today it is only ever caught downstream, accidentally, because no
   * real "Basílica de Santa Mónica" exists for the resolver to find
   * (experience-proposal-resolver.service.spec.ts's NO_OSM_MATCH cases).
   */
  it('Case G: accepts a componentHint whose cited evidence key exists but does not check the evidence TEXT actually supports the named component (RW1 Santa Mónica/ev-11)', () => {
    // The real ev-11 SourceObservation text — it never mentions "Basílica
    // de Santa Mónica" or anything semantically equivalent to it.
    const ev11Snippet =
      'Commissioned by the Jesuits in the mid-18th century and completed in 1876, ' +
      'this church gave the neighborhood its modern name (named after Saint Peter ' +
      'Gonzalez Telmo, patron saint of sailors).';

    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'San Telmo Historic Walk',
            themes: ['history'],
            traits: [],
            intents: ['walk'],
            componentHints: [
              {
                key: 'basilica-santa-monica',
                name: 'Basílica de Santa Mónica',
                role: 'waypoint',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['ev-11'],
              },
            ],
            evidenceKeys: ['ev-11'],
            shortReason: 'Historic church on the route',
          },
        ],
      },
      // extractExperienceCandidates only ever receives the set of KNOWN
      // evidence KEYS, never the observations' own text content -- so no
      // amount of internal logic here could check `ev11Snippet` against
      // the hint name even if it tried to. This is itself part of the
      // Stage 1 freeze: the source-support gate the amendment requires
      // cannot be implemented inside this function's current signature.
      new Set(['ev-11']),
      8,
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints).toEqual([
      expect.objectContaining({
        key: 'basilica-santa-monica',
        name: 'Basílica de Santa Mónica',
        evidenceKeys: ['ev-11'],
      }),
    ]);
    // Documents the gap, not a claim about ev11Snippet's content being
    // consulted anywhere in this call.
    expect(ev11Snippet).not.toContain('Santa Mónica');
  });
});
