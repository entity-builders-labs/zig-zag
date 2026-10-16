import {
  candidateMatchesPreferenceFacet,
  preferenceWeightForExperience,
} from './preference-facet-matching.util';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { AssertionTargetDimension } from '../preferences/preference-facet-vocabulary';
import { RequestedFacet } from '../interfaces/preference-spec.interface';
import { selectedFacetFixture } from '../fixtures/requested-facet.fixture';

describe('candidateMatchesPreferenceFacet', () => {
  // Accepts any string so tests can probe non-target dimensions too.
  const baseFacet = (dimension: string, key: string): SemanticTarget => ({
    dimension: dimension as AssertionTargetDimension,
    key,
  });

  describe('invalid / empty inputs', () => {
    it('returns false for null/undefined experience or facet', () => {
      expect(
        candidateMatchesPreferenceFacet(null, baseFacet('theme', 'art')),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          { themes: ['art'] },
          null as unknown as SemanticTarget,
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

    it('returns false for dimensions that are not assertion targets', () => {
      const exp = {
        canonicalName: 'Relaxed Tour',
        description: 'Super relaxed and balanced pace',
        traits: ['relaxed', 'custom_dim_val'],
        dimensionedTraits: [
          { dimension: 'tourism_intensity', key: 'iconic' },
          { dimension: 'trait', key: 'custom_dim_val' },
        ],
      };
      // exploration_style is a meta-preference (a composition tilt), never
      // a matched facet.
      expect(
        candidateMatchesPreferenceFacet(
          exp,
          baseFacet('exploration_style', 'iconic'),
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

  describe('dimension: trait (open strings, no shared typed identity)', () => {
    it('never matches by string equality against legacy traits or dimensioned traits', () => {
      const exp = {
        canonicalName: 'Family Winery',
        traits: ['vegan', 'organic'],
        metadata: { traits: ['family friendly'] },
        dimensionedTraits: [
          { dimension: 'general', key: 'family_owned', label: 'Family Owned' },
          { dimension: 'trait', key: 'guided_tour', label: 'Guided Tour' },
        ],
      };
      for (const key of [
        'vegan',
        'family friendly',
        'family_owned',
        'guided_tour',
      ]) {
        expect(
          candidateMatchesPreferenceFacet(exp, baseFacet('trait', key)),
        ).toBe(false);
      }
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

describe('preferenceWeightForExperience', () => {
  const facet = (
    dimension: AssertionTargetDimension,
    key: string,
    weight: number,
  ): RequestedFacet => ({
    ...selectedFacetFixture(dimension, key),
    importance: weight,
    weight,
  });

  it('sums distinct canonically satisfied facets and ignores duplicate representations', () => {
    const experience = {
      themes: ['history'],
      intents: ['walk'],
      qualityScore: 4,
      components: [{ geoEntity: { latitude: 1, longitude: 2 } }],
    };
    expect(
      preferenceWeightForExperience(experience, [
        facet('theme', 'history', 1.0),
        facet('theme', 'history', 1.0),
        facet('intent', 'walk', 0.7),
        facet('theme', 'food', 0.4),
      ]),
    ).toBe(1.7);
  });

  it('excludes weak semantic matches from planner preference weight', () => {
    const facetDefinition = facet('theme', 'history', 1);
    const strong = {
      themes: ['history'],
      qualityScore: 4,
      components: [{ geoEntity: { latitude: 1, longitude: 2 } }],
    };
    expect(preferenceWeightForExperience(strong, [facetDefinition])).toBe(1);
    expect(
      preferenceWeightForExperience(
        { themes: ['history'], qualityScore: 2, components: strong.components },
        [facetDefinition],
      ),
    ).toBe(0);
    expect(
      preferenceWeightForExperience({ themes: ['history'], qualityScore: 4 }, [
        facetDefinition,
      ]),
    ).toBe(0);
    expect(
      preferenceWeightForExperience(
        {
          themes: ['history'],
          qualityScore: 4,
          components: strong.components,
          metadata: { classification: { state: 'degraded' } },
        },
        [facetDefinition],
      ),
    ).toBe(0);
  });

  it('does not infer preference truth from semantic-looking text', () => {
    const experience = {
      canonicalName: 'Historic architecture museum',
      description: 'A very similar history and architecture experience',
    };
    expect(
      preferenceWeightForExperience(experience, [
        facet('theme', 'history', 1),
        facet('theme', 'architecture', 0.7),
      ]),
    ).toBe(0);
  });
});
