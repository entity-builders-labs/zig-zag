import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildClassificationResponseJsonSchema,
  CANONICAL_THEME_KEYS,
  CANONICAL_INTENT_KEYS,
} from './experience-semantic-classification.prompt';

describe('experience-semantic-classification.prompt', () => {
  describe('buildClassificationSystemPrompt', () => {
    const prompt = buildClassificationSystemPrompt();

    it('frames evidence-only classification and forbids user preferences', () => {
      expect(prompt).toMatch(/evidence.only/i);
      expect(prompt.toLowerCase()).toContain('never');
      expect(prompt.toLowerCase()).toMatch(
        /user('s)?\s+preference|traveler('s)?\s+preference/,
      );
    });

    it('requires themes/intents to be substantially supported, not incidental', () => {
      expect(prompt.toLowerCase()).toContain('substantially supported');
    });

    it('allows empty arrays when evidence does not support anything', () => {
      expect(prompt.toLowerCase()).toContain('empty array');
    });

    it('requires every accepted fact to cite real evidence keys', () => {
      expect(prompt.toLowerCase()).toContain('evidence key');
    });

    it('forbids inventing structured dimensioned facets', () => {
      expect(prompt).toContain('dimensionedFacets');
    });

    it('forbids generic sentence-shaped traits', () => {
      expect(prompt.toLowerCase()).toContain('sentence');
    });

    it('draws themes/intents only from the canonical controlled vocabulary', () => {
      for (const key of CANONICAL_THEME_KEYS) {
        expect(prompt).toContain(key);
      }
      for (const key of CANONICAL_INTENT_KEYS) {
        expect(prompt).toContain(key);
      }
    });
  });

  describe('buildClassificationUserPrompt', () => {
    it('includes the entity name and one line per evidence item', () => {
      const prompt = buildClassificationUserPrompt('Cabildo de Buenos Aires', [
        {
          key: 'ev-1',
          source: 'wikivoyage',
          title: 'San Telmo',
          snippet: 'A colonial-era town hall, now a history museum.',
        },
      ]);

      expect(prompt).toContain('Cabildo de Buenos Aires');
      expect(prompt).toContain('[ev-1]');
      expect(prompt).toContain(
        'A colonial-era town hall, now a history museum.',
      );
    });

    it('never includes traveler preference fields -- there is no such parameter', () => {
      // buildClassificationUserPrompt's signature itself has no preference
      // parameter; this test documents that invariant structurally rather
      // than by string-scanning arbitrary prose.
      expect(buildClassificationUserPrompt.length).toBe(2); // (canonicalName, evidence) only
    });
  });

  describe('buildClassificationResponseJsonSchema', () => {
    const schema = buildClassificationResponseJsonSchema() as any;

    it('constrains themes/intents to the canonical enums and leaves traits open', () => {
      expect(schema.properties.themes.items.enum).toEqual([
        ...CANONICAL_THEME_KEYS,
      ]);
      expect(schema.properties.intents.items.enum).toEqual([
        ...CANONICAL_INTENT_KEYS,
      ]);
      expect(schema.properties.traits.items.enum).toBeUndefined();
    });

    it('requires reasoningEvidence entries to carry facet, evidenceKeys and reason', () => {
      const reasoningEvidenceItem = schema.properties.reasoningEvidence.items;
      expect(reasoningEvidenceItem.required).toEqual(
        expect.arrayContaining(['facet', 'evidenceKeys', 'reason']),
      );
    });

    it('has no field for dimensionedFacets', () => {
      expect(schema.properties.dimensionedFacets).toBeUndefined();
      expect(JSON.stringify(schema)).not.toContain('dimensionedFacets');
    });
  });
});
