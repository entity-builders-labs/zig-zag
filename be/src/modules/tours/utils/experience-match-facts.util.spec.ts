import {
  catalogMatchFacts,
  discoveryCandidateSemanticFacts,
  semanticFacts,
} from './experience-match-facts.util';
import { classificationSemanticFacts } from './experience-classification-convergence.util';

const geo = [{ geoEntity: { latitude: -34.6, longitude: -58.4 } }];

describe('experience match-facts adapters', () => {
  it('keeps only schema keys, normalizing formatting and never translating words', () => {
    expect(
      semanticFacts({
        themes: ['History', 'historia', 'not_a_key', 42],
        intents: ['Day-Trip', 'caminata'],
      }),
    ).toEqual({
      themes: ['history'],
      intents: ['day_trip'],
      dimensionedFacts: [],
    });
  });

  it('keeps dimensioned facts only on closed non-theme/intent dimensions with schema keys', () => {
    expect(
      semanticFacts({
        dimensionedTraits: [
          { dimension: 'winery_scale', key: 'Boutique', label: 'Boutique' },
          { dimension: 'general', key: 'iconic' },
          { dimension: 'trait', key: 'craft_beer' },
          { dimension: 'theme', key: 'history' },
          { dimension: 'accessibility', key: 'silla_de_ruedas' },
          { dimension: 'accessibility', key: 'wheelchair_access' },
          'not-an-object',
        ],
      }).dimensionedFacts,
    ).toEqual([
      { dimension: 'winery_scale', key: 'boutique' },
      { dimension: 'accessibility', key: 'wheelchair_access' },
    ]);
  });

  it('adapts a catalog row once: classification state, geography, quality and duration stay typed, UNKNOWN stays null', () => {
    expect(
      catalogMatchFacts({
        themes: ['history'],
        intents: [],
        dimensionedTraits: [],
        classification: { state: 'degraded' },
        components: geo,
        qualityScore: 7,
        durationMinutes: null,
      }),
    ).toEqual({
      semantic: { themes: ['history'], intents: [], dimensionedFacts: [] },
      classificationState: 'DEGRADED',
      hasResolvedGeography: true,
      qualityScore: null,
      durationMinutes: null,
    });
    expect(
      catalogMatchFacts({
        themes: [],
        intents: [],
        dimensionedTraits: [],
        classification: undefined,
        components: [{ geoEntity: { latitude: Number.NaN, longitude: 1 } }],
        qualityScore: 4,
        durationMinutes: 60,
      }),
    ).toMatchObject({
      classificationState: 'UNCLASSIFIED',
      hasResolvedGeography: false,
      qualityScore: 4,
      durationMinutes: 60,
    });
  });

  it('adapts a discovery candidate from its themes and intents; open traits carry no typed identity', () => {
    expect(
      discoveryCandidateSemanticFacts({
        themes: ['food'],
        intents: ['walk'],
      }),
    ).toEqual({ themes: ['food'], intents: ['walk'], dimensionedFacts: [] });
  });

  it('adapts a classification from classifier-owned semantics only', () => {
    expect(
      classificationSemanticFacts({
        themes: ['history'],
        intents: ['visit'],
        traits: ['quiet'],
      }),
    ).toEqual({
      themes: ['history'],
      intents: ['visit'],
      dimensionedFacts: [],
    });
  });
});
