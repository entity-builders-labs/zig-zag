import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';
import { PreferenceFacet } from '../preferences/preference-facet.interface';

describe('candidateMatchesPreferenceFacet', () => {
  const baseFacet = (
    dimension: string,
    key: string,
    overrides?: Partial<PreferenceFacet>,
  ): PreferenceFacet => ({
    dimension,
    key,
    importance: 1.0,
    confidence: 1.0,
    source: 'wizard',
    ...overrides,
  });

  describe('invalid / empty inputs', () => {
    it('returns false for null/undefined experience or facet', () => {
      expect(
        candidateMatchesPreferenceFacet(null, baseFacet('theme', 'art')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          { themes: ['art'] },
          null as unknown as PreferenceFacet,
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          { themes: ['art'] },
          baseFacet('', 'art'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          { themes: ['art'] },
          baseFacet('theme', ''),
        ),
      ).toBe(false);
    });

    it('returns false for unknown dimensions and stale exploration_style keys', () => {
      const exp = {
        canonicalName: 'Relaxed Tour',
        description: 'Super relaxed and balanced pace',
        traits: ['relaxed', 'custom_dim_val'],
      };
      // 'relaxed' is a stale Phase-2 key — no evidence-target mapping, no match.
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('exploration_style', 'relaxed'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('unknown_dimension', 'custom_dim_val'),
        ),
      ).toBe(false);
    });
  });

  describe('exploration_style (Phase 6)', () => {
    it('iconic matches explicit dimensioned tourism_intensity iconic|popular', () => {
      const iconicExp = {
        canonicalName: 'Obelisco',
        dimensionedTraits: [{ dimension: 'tourism_intensity', key: 'iconic' }],
      };
      const popularExp = {
        metadata: {
          preferenceFacets: [
            { dimension: 'tourism_intensity', key: 'popular' },
          ],
        },
      };
      expect(
        candidateMatchesPreferenceFacet(
          iconicExp,
          baseFacet('exploration_style', 'iconic'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          popularExp,
          baseFacet('exploration_style', 'iconic'),
        ),
      ).toBe(true);
    });

    it('local_deep_dive matches tourism_intensity hidden|local or local_character authentic', () => {
      const hiddenExp = {
        metadata: {
          dimensions: { tourism_intensity: 'hidden' },
        },
      };
      const authenticExp = {
        dimensionedTraits: [{ dimension: 'local_character', key: 'authentic' }],
      };
      expect(
        candidateMatchesPreferenceFacet(
          hiddenExp,
          baseFacet('exploration_style', 'local_deep_dive'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          authenticExp,
          baseFacet('exploration_style', 'local_deep_dive'),
        ),
      ).toBe(true);
    });

    it('never matches from name / description / duration / components — only explicit dimensioned evidence', () => {
      const noEvidence = {
        canonicalName:
          'Iconic landmark tour of the most popular authentic spots',
        description:
          'A hidden gem for local deep dives, very iconic and popular',
        durationMinutes: 45,
        components: [{ role: 'venue' }],
        themes: ['history'],
        traits: ['iconic', 'authentic'],
      };
      expect(
        candidateMatchesPreferenceFacet(
          noEvidence,
          baseFacet('exploration_style', 'iconic'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          noEvidence,
          baseFacet('exploration_style', 'local_deep_dive'),
        ),
      ).toBe(false);
    });

    it('cross-dimension isolation: an iconic facet does not match tourism_intensity local evidence, and vice versa', () => {
      const localExp = {
        dimensionedTraits: [{ dimension: 'tourism_intensity', key: 'local' }],
      };
      expect(
        candidateMatchesPreferenceFacet(
          localExp,
          baseFacet('exploration_style', 'iconic'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          localExp,
          baseFacet('exploration_style', 'local_deep_dive'),
        ),
      ).toBe(true);
    });
  });

  describe('dimension: theme', () => {
    it('matches experience.themes ignoring case, accents, and punctuation', () => {
      const exp = {
        canonicalName: 'Teatro Colón',
        themes: ['Música & Ópera', 'Architecture'],
      };
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('theme', 'musica opera'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('theme', 'architecture'),
        ),
      ).toBe(true);
    });

    it('matches experience.metadata.themes', () => {
      const exp = {
        canonicalName: 'Teatro Colón',
        metadata: { themes: ['history', 'culture'] },
      };
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('theme', 'history')),
      ).toBe(true);
    });

    it('does NOT match description, name, or traits for a theme facet', () => {
      const exp = {
        canonicalName: 'Art Gallery Cafe',
        description:
          'A historic venue with wonderful architecture and vibrant history',
        traits: ['history', 'architecture'],
        themes: ['gastronomy'],
      };
      // 'history' is only in description and traits, NOT in themes
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('theme', 'history')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('theme', 'architecture'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('theme', 'art')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('theme', 'gastronomy')),
      ).toBe(true);
    });
  });

  describe('dimension: intent', () => {
    it('matches experience.intents and metadata.archetypes', () => {
      const exp = {
        canonicalName: 'San Telmo Walk',
        intents: ['walk', 'route_like'],
        metadata: { archetypes: ['cultural_route'] },
      };
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('intent', 'walk')),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('intent', 'cultural_route'),
        ),
      ).toBe(true);
    });

    it('does NOT match description text or traits for an intent facet', () => {
      const exp = {
        canonicalName: 'Famous Walkway',
        description: 'A beautiful walk through scenic streets',
        traits: ['walk', 'visit'],
        intents: ['food'],
      };
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('intent', 'walk')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('intent', 'visit')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('intent', 'food')),
      ).toBe(true);
    });
  });

  describe('dimension: trait', () => {
    it('matches legacy experience.traits and metadata.traits', () => {
      const exp = {
        canonicalName: 'Vegan Bakery',
        traits: ['vegan', 'organic'],
        metadata: { traits: ['family friendly'] },
      };
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('trait', 'vegan')),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('trait', 'family friendly'),
        ),
      ).toBe(true);
    });

    it('matches relational dimensionedTraits with dimension general or trait', () => {
      const exp = {
        canonicalName: 'Historic Winery',
        dimensionedTraits: [
          { dimension: 'general', key: 'family_owned', label: 'Family Owned' },
          { dimension: 'trait', key: 'guided_tour', label: 'Guided Tour' },
          { dimension: 'winery_scale', key: 'boutique', label: 'Boutique' },
        ],
      };
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('trait', 'family_owned'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('trait', 'Family Owned'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('trait', 'guided_tour')),
      ).toBe(true);
      // boutique has dimension winery_scale, not trait/general, so trait matcher ignores it
      expect(
        candidateMatchesPreferenceFacet(exp, baseFacet('trait', 'boutique')),
      ).toBe(false);
    });
  });

  describe('structured dimensions (winery_scale, tourism_intensity, nature_type, local_character)', () => {
    it('winery_scale:boutique does NOT match mere description or name mention', () => {
      const exp = {
        canonicalName: 'Boutique Winery & Tasting',
        description: 'A lovely boutique experience in the vineyards.',
        themes: ['wine'],
      };
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('winery_scale', 'boutique'),
        ),
      ).toBe(false);
    });

    it('winery_scale:boutique does NOT match generic trait: "boutique"', () => {
      const exp = {
        canonicalName: 'Bodega San Rafael',
        traits: ['boutique'],
        dimensionedTraits: [
          { dimension: 'general', key: 'boutique', label: 'boutique' },
        ],
      };
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('winery_scale', 'boutique'),
        ),
      ).toBe(false);
    });

    it('winery_scale:boutique DOES match explicit dimensioned trait winery_scale:boutique', () => {
      const expWithTopLevel = {
        canonicalName: 'Bodega Catena Zapata',
        dimensionedTraits: [
          { dimension: 'winery_scale', key: 'boutique', label: 'Boutique' },
        ],
      };
      expect(
        candidateMatchesPreferenceFacet(
          expWithTopLevel,
          baseFacet('winery_scale', 'boutique'),
        ),
      ).toBe(true);

      const expWithMetadata = {
        canonicalName: 'Bodega Catena Zapata',
        metadata: {
          dimensionedTraits: [
            { dimension: 'winery_scale', key: 'boutique', label: 'Boutique' },
          ],
        },
      };
      expect(
        candidateMatchesPreferenceFacet(
          expWithMetadata,
          baseFacet('winery_scale', 'boutique'),
        ),
      ).toBe(true);
    });

    it('tourism_intensity:hidden matches explicit dimensioned evidence only', () => {
      const expWithoutDim = {
        canonicalName: 'Hidden Gem Cafe',
        description: 'A hidden secret spot in the city',
        traits: ['hidden', 'secret'],
      };
      expect(
        candidateMatchesPreferenceFacet(
          expWithoutDim,
          baseFacet('tourism_intensity', 'hidden'),
        ),
      ).toBe(false);

      const expWithDim = {
        canonicalName: 'Secret Courtyard',
        dimensionedTraits: [
          { dimension: 'tourism_intensity', key: 'hidden', label: 'Hidden' },
        ],
      };
      expect(
        candidateMatchesPreferenceFacet(
          expWithDim,
          baseFacet('tourism_intensity', 'hidden'),
        ),
      ).toBe(true);
    });

    it('matches explicit metadata.dimensions map or metadata.preferenceFacets', () => {
      const expDimensions = {
        canonicalName: 'Mountain Trail',
        metadata: {
          dimensions: {
            nature_type: 'mountain',
            local_character: 'authentic',
          },
        },
      };
      expect(
        candidateMatchesPreferenceFacet(
          expDimensions,
          baseFacet('nature_type', 'mountain'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          expDimensions,
          baseFacet('local_character', 'authentic'),
        ),
      ).toBe(true);
      expect(
        candidateMatchesPreferenceFacet(
          expDimensions,
          baseFacet('nature_type', 'forest'),
        ),
      ).toBe(false);

      const expFacets = {
        canonicalName: 'Palermo Soho Walk',
        metadata: {
          preferenceFacets: [{ dimension: 'local_character', key: 'bohemian' }],
        },
      };
      expect(
        candidateMatchesPreferenceFacet(
          expFacets,
          baseFacet('local_character', 'bohemian'),
        ),
      ).toBe(true);
    });
  });
});
