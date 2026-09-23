import { extractExperienceCandidates } from './experience-candidate-extraction.util';

/** Evidence whose text trivially contains `supportSpan`, for tests whose
 * concern is unrelated to source-support verification itself. */
const ev = (key: string, text: string) => ({ key, text });

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
                evidenceKeys: ['ev-1'],
                supportSpan: 'Costanera Norte is a riverside avenue',
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'Evidence-backed route',
          },
        ],
      },
      [ev('ev-1', 'Costanera Norte is a riverside avenue popular for walks.')],
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
                evidenceKeys: ['ev-1'],
                supportSpan: 'the Plaza is the main square',
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'no sequence claim',
          },
        ],
      },
      [ev('ev-1', 'Visitors gather at the Plaza is the main square in town.')],
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
                evidenceKeys: ['ev-1'],
                supportSpan: 'start at the Plaza then walk south',
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'evidence describes start-then-walk sequence',
            orderedByEvidence: true,
          },
        ],
      },
      [
        ev(
          'ev-1',
          'The route: start at the Plaza then walk south to the river.',
        ),
      ],
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
                evidenceKeys: ['ev-1'],
                supportSpan: 'The Bar is a local favorite',
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'evidence-backed crawl',
          },
        ],
      },
      [ev('ev-1', 'The Bar is a local favorite among craft beer fans.')],
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
                evidenceKeys: ['ev-9'],
                supportSpan: 'irrelevant',
              },
            ],
            evidenceKeys: ['ev-9'],
          },
        ],
      },
      [ev('ev-1', 'unrelated evidence text')],
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
                evidenceKeys: ['ev-1'],
                supportSpan: 'Recoleta Cemetery is located at Junín 1760',
                addressHint: 'Junín 1760',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [ev('ev-1', 'Recoleta Cemetery is located at Junín 1760, Buenos Aires.')],
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
                evidenceKeys: ['ev-1'],
                supportSpan: 'Teatro Colón is the opera house',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [ev('ev-1', 'Teatro Colón is the opera house downtown.')],
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
          evidenceKeys: ['ev-10'],
          supportSpan: 'the San Telmo Market draws antique collectors',
        },
        {
          key: 'lezama-park',
          name: 'Lezama Park',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['ev-10'],
          supportSpan: 'Lezama Park anchors the southern end of the walk',
        },
      ],
      evidenceKeys: ['ev-10'],
      shortReason:
        "Evidence explicitly describes a specific walking tour named 'San Telmo Colonial Walking Tour'.",
      orderedByEvidence: false,
    };

    const result = extractExperienceCandidates(
      bareCandidateObject,
      [
        ev(
          'ev-10',
          'On Sundays the San Telmo Market draws antique collectors, and Lezama Park anchors the southern end of the walk.',
        ),
      ],
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
      [ev('ev-1', 'irrelevant')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toEqual([]);
  });

  /**
   * Stage 2 cutover (component-resolution-and-partial-composite-recovery-
   * plan.md): flips the Stage 1 characterization (Case G) from "accepted"
   * to "rejected before geographic/provider acquisition ever runs". Real
   * RW1 fixture: cold-2 pass 1's extractor emitted a "Basílica de Santa
   * Mónica" componentHint citing ev-11, whose actual captured snippet
   * ("Commissioned by the Jesuits... this church gave the neighborhood its
   * modern name [St. Peter Gonzalez Telmo]...") never names that basilica
   * or an equivalent entity -- confirmed against
   * spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/cold-2/
   * web-extraction.json.
   */
  it('Case G (Stage 2): rejects a componentHint whose cited evidence key exists but whose text never supports the named component (RW1 Santa Mónica/ev-11), before any geographic/provider acquisition', () => {
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
                evidenceKeys: ['ev-11'],
                // A hallucinating extractor cannot quote real text mentioning
                // the basilica from ev-11 (it does not exist there), so any
                // supportSpan it fabricates is either absent or not a real
                // substring of the cited evidence -- both are rejected.
                supportSpan: 'Basílica de Santa Mónica, a colonial-era church',
              },
            ],
            evidenceKeys: ['ev-11'],
            shortReason: 'Historic church on the route',
          },
        ],
      },
      [ev('ev-11', ev11Snippet)],
      8,
    );

    // Rejected entirely: the only component fails source-support and no
    // other component exists to keep the candidate alive.
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(
      /no source-supported componentHints remain/,
    );
    expect(ev11Snippet).not.toContain('Santa Mónica');
  });

  it('drops only the unsupported componentHint while a sibling with genuine source support survives in the same candidate', () => {
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
                evidenceKeys: ['ev-11'],
                supportSpan: 'Basílica de Santa Mónica, a colonial-era church',
              },
              {
                key: 'plaza-dorrego',
                name: 'Plaza Dorrego',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-12'],
                supportSpan: 'Plaza Dorrego hosts a Sunday antiques fair',
              },
              {
                key: 'defensa-street',
                name: 'Calle Defensa',
                role: 'route',
                expectedKind: 'ROUTE',
                evidenceKeys: ['ev-12'],
                supportSpan: 'Calle Defensa runs the length of the walk',
              },
            ],
            evidenceKeys: ['ev-11', 'ev-12'],
            shortReason: 'walk with one unsupported stop',
          },
        ],
      },
      [
        ev(
          'ev-11',
          'Commissioned by the Jesuits, this church gave the neighborhood its name.',
        ),
        ev(
          'ev-12',
          'Plaza Dorrego hosts a Sunday antiques fair, and Calle Defensa runs the length of the walk.',
        ),
      ],
      8,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints.map((hint) => hint.key)).toEqual(
      ['plaza-dorrego', 'defensa-street'],
    );
    expect(result.validationErrors.join(' ')).toMatch(
      /Basílica de Santa Mónica.*dropped: source-support/,
    );
  });

  it('rejects a componentHint whose evidenceKeys reference a key not present in the evidence set', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Walk',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                key: 'a',
                name: 'Plaza',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-missing'],
                supportSpan: 'the Plaza',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [ev('ev-1', 'irrelevant text mentioning the Plaza')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(/invalid evidence/);
  });

  it('drops a componentHint that cites a real evidence key whose text does not contain the claimed supportSpan', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Walk',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                key: 'a',
                name: 'Ghost Venue',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
                supportSpan: 'Ghost Venue is a hidden speakeasy',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [ev('ev-1', 'This street is known for its colonial architecture.')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(
      /SPAN_NOT_FOUND_IN_CITED_EVIDENCE/,
    );
  });

  it('drops a componentHint whose supportSpan is real text but taken from a DIFFERENT evidence record than the one it cites', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Walk',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                key: 'a',
                name: 'Wrong Record Venue',
                role: 'venue',
                expectedKind: 'PLACE',
                // cites ev-1, but the supportSpan is only real text from ev-2
                evidenceKeys: ['ev-1'],
                supportSpan: 'Lezama Park anchors the southern end',
              },
            ],
            evidenceKeys: ['ev-1', 'ev-2'],
          },
        ],
      },
      [
        ev('ev-1', 'This street is known for its colonial architecture.'),
        ev('ev-2', 'Lezama Park anchors the southern end of the walk.'),
      ],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(
      /SPAN_NOT_FOUND_IN_CITED_EVIDENCE/,
    );
  });

  it('drops a componentHint with no supportSpan at all', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Walk',
            themes: [],
            traits: [],
            intents: [],
            componentHints: [
              {
                key: 'a',
                name: 'Plaza',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [ev('ev-1', 'The Plaza is the main square.')],
      8,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors.join(' ')).toMatch(/NO_SUPPORT_SPAN/);
  });

  it('accepts a translated/localized name whose supportSpan quotes the evidence in its ORIGINAL wording (alias/translation is not required to solve identity here)', () => {
    const result = extractExperienceCandidates(
      {
        candidates: [
          {
            name: 'Day trip',
            themes: ['nature'],
            traits: [],
            intents: ['visit'],
            componentHints: [
              {
                key: 'park',
                // The LLM is allowed to translate the entity name to the
                // canonical local-language form; the evidence itself was
                // only ever in English.
                name: 'Parque Nacional El Leoncito',
                role: 'area',
                expectedKind: 'AREA',
                evidenceKeys: ['ev-1'],
                supportSpan:
                  'El Leoncito National Park is known for its dark skies',
              },
            ],
            evidenceKeys: ['ev-1'],
          },
        ],
      },
      [
        ev(
          'ev-1',
          'El Leoncito National Park is known for its dark skies and observatories.',
        ),
      ],
      8,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].componentHints[0].name).toBe(
      'Parque Nacional El Leoncito',
    );
  });
});
