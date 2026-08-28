import {
  validateProposal,
  validateKindRules,
  buildEvidenceMap,
  MAX_DISCOVERY_HINTS_PER_PROPOSAL,
} from './discovery-extraction-shared.util';

describe('discovery-extraction-shared.util', () => {
  const validEvidenceKeys = ['ev-1', 'ev-2'];

  function baseProposal(overrides: Record<string, any> = {}) {
    return {
      name: 'Caminito',
      kind: 'POI',
      themes: ['culture'],
      entityHints: [
        {
          key: 'caminito',
          name: 'Caminito',
          role: 'venue',
          expectedType: 'street_museum',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 60,
      shortReason: 'Colorful pedestrian street',
      evidenceKeys: ['ev-1'],
      ...overrides,
    };
  }

  describe('validateProposal', () => {
    it('accepts a well-formed proposal', () => {
      expect(validateProposal(baseProposal(), validEvidenceKeys)).toEqual([]);
    });

    it('rejects a proposal referencing an unknown evidence key', () => {
      const errors = validateProposal(
        baseProposal({ evidenceKeys: ['ev-999'] }),
        validEvidenceKeys,
      );
      expect(errors.some((e) => e.includes('unknown evidence key'))).toBe(true);
    });

    it('rejects a proposal with no evidenceKeys', () => {
      const errors = validateProposal(
        baseProposal({ evidenceKeys: [] }),
        validEvidenceKeys,
      );
      expect(errors.some((e) => e.includes('missing evidenceKeys'))).toBe(true);
    });

    it('rejects a hint missing the required boolean', () => {
      const errors = validateProposal(
        baseProposal({
          entityHints: [
            {
              key: 'x',
              name: 'X',
              role: 'venue',
              expectedType: 'museum',
            },
          ],
        }),
        validEvidenceKeys,
      );
      expect(errors.some((e) => e.includes('missing required'))).toBe(true);
    });

    it('rejects a required hint with an unknown evidence key', () => {
      const errors = validateProposal(
        baseProposal({
          entityHints: [
            {
              key: 'caminito',
              name: 'Caminito',
              role: 'venue',
              expectedType: 'street_museum',
              required: true,
              evidenceKeys: ['ev-999'],
            },
          ],
        }),
        validEvidenceKeys,
      );
      expect(errors.some((e) => e.includes('unknown evidence key'))).toBe(true);
    });

    it('accepts an optional hint with no evidenceKeys', () => {
      const errors = validateProposal(
        baseProposal({
          kind: 'NEIGHBORHOOD_WALK',
          entityHints: [
            {
              key: 'area-1',
              name: 'San Telmo',
              role: 'area',
              expectedType: 'neighborhood',
              required: true,
              evidenceKeys: ['ev-1'],
            },
            {
              key: 'wp-1',
              name: 'Plaza Dorrego',
              role: 'waypoint',
              expectedType: 'square',
              required: false,
            },
            {
              key: 'wp-2',
              name: 'Some Church',
              role: 'waypoint',
              expectedType: 'church',
              required: false,
            },
          ],
        }),
        validEvidenceKeys,
      );
      expect(errors).toEqual([]);
    });

    it('rejects a proposal exceeding the technical hint cap', () => {
      const tooMany = Array.from(
        { length: MAX_DISCOVERY_HINTS_PER_PROPOSAL + 1 },
        (_, i) => ({
          key: `wp-${i}`,
          name: `Stop ${i}`,
          role: 'waypoint',
          expectedType: 'landmark',
          required: false,
        }),
      );
      const errors = validateProposal(
        baseProposal({ entityHints: tooMany }),
        validEvidenceKeys,
      );
      expect(errors.some((e) => e.includes('too many entity hints'))).toBe(
        true,
      );
    });
  });

  describe('validateKindRules', () => {
    it('requires exactly one required hint for POI', () => {
      expect(
        validateKindRules('POI', [
          { role: 'venue', required: true },
          { role: 'waypoint', required: true },
        ]),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('exactly one required hint'),
        ]),
      );
    });

    it('requires exactly one required area hint for AREA', () => {
      expect(
        validateKindRules('AREA', [{ role: 'venue', required: true }]),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('exactly one required area hint'),
        ]),
      );
    });

    it('rejects NEIGHBORHOOD_WALK missing a required area hint (live semantic-omission regression)', () => {
      // Reproduces a real Gemini response observed live: all hints returned
      // as required=false, with the actual area (San Telmo) omitted
      // entirely as a role="area" hint. JSON Schema alone can't catch this
      // — only this business-rule check can, regardless of which provider
      // extracted the proposal.
      const hints = [
        {
          key: 'plaza-dorrego',
          name: 'Plaza Dorrego',
          role: 'waypoint',
          required: false,
        },
        {
          key: 'mercado-san-telmo',
          name: 'Mercado de San Telmo',
          role: 'waypoint',
          required: false,
        },
        {
          key: 'calle-defensa',
          name: 'Calle Defensa',
          role: 'route',
          required: false,
        },
      ];
      const errors = validateKindRules('NEIGHBORHOOD_WALK', hints);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('exactly one required area hint'),
        ]),
      );
    });

    it('requires at least 2 additional hints for NEIGHBORHOOD_WALK', () => {
      const hints = [
        { role: 'area', required: true },
        { role: 'waypoint', required: false },
      ];
      expect(validateKindRules('NEIGHBORHOOD_WALK', hints)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('at least 2 additional hints'),
        ]),
      );
    });

    it('accepts a well-formed NEIGHBORHOOD_WALK', () => {
      const hints = [
        { role: 'area', required: true },
        { role: 'waypoint', required: false },
        { role: 'route', required: false },
      ];
      expect(validateKindRules('NEIGHBORHOOD_WALK', hints)).toEqual([]);
    });

    it('requires at least one required route hint for ROUTE', () => {
      expect(
        validateKindRules('ROUTE', [{ role: 'area', required: true }]),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('required route hint'),
        ]),
      );
    });

    it('requires at least 2 resolvable entities for EXPERIENCE', () => {
      expect(
        validateKindRules('EXPERIENCE', [{ role: 'venue', required: true }]),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('at least 2 resolvable entities'),
        ]),
      );
    });
  });

  describe('buildEvidenceMap', () => {
    it('maps evidence by key', () => {
      const map = buildEvidenceMap({
        provider: 'test',
        model: 'test',
        groundingStatus: 'applied',
        evidence: [
          { key: 'ev-1', source: 'a', snippet: 'one' },
          { key: 'ev-2', source: 'b', snippet: 'two' },
        ],
      });
      expect(map.size).toBe(2);
      expect(map.get('ev-1')?.snippet).toBe('one');
    });

    it('returns an empty map when no search result is provided', () => {
      expect(buildEvidenceMap(undefined).size).toBe(0);
    });
  });
});
