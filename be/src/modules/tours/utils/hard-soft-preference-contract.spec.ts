import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { evaluateExperiencePreferences } from './experience-preference-evaluator.util';
import { normalizeWizardFacet } from './preference-facet-merge.util';

const baseIntent: NormalizedPreferenceIntent = {
  preferredFacets: [],
  excludedThemes: [],
  excludedTraits: [],
  hardExclusions: [],
  softConstraints: [],
  ambiguities: [],
  dietaryPreferences: [],
  accessibilityPreferences: [],
  budgetPreferences: [],
  groupPreferences: [],
  positiveSemanticQuery: '',
  notes: [],
};

describe('hard vs soft Experience preference contract', () => {
  it('keeps soft constraints as score penalties and never as hard exclusions', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Paseo cultural concurrido',
        themes: ['culture'],
        traits: ['crowded'],
      },
      {
        ...baseIntent,
        preferredFacets: [normalizeWizardFacet('theme', 'culture')],
        softConstraints: ['crowded'],
      },
    );

    expect(result.positiveMatches).toContain('culture');
    expect(result.negativeMatches).toContain('crowded');
    expect(result.exclusionMatches).toEqual([]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('records hard exclusions separately so strict selection can reject the candidate', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Arte en la Catedral Metropolitana',
        themes: ['art', 'religion'],
      },
      {
        ...baseIntent,
        preferredFacets: [normalizeWizardFacet('theme', 'art')],
        hardExclusions: ['religion'],
      },
    );

    expect(result.positiveMatches).toContain('art');
    expect(result.exclusionMatches).toContain('religion');
    expect(result.reasons).toContain('exclusion:religion');
  });

  it('does not turn an optional component into a hard exclusion', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Caminata histórica secular',
        themes: ['history'],
        components: [
          {
            required: false,
            role: 'optional_stop',
            geoEntity: {
              name: 'Catedral Metropolitana',
              kind: 'PLACE',
            },
          },
        ],
      },
      {
        ...baseIntent,
        hardExclusions: ['religion'],
      },
    );

    expect(result.exclusionMatches).toEqual([]);
  });

  it('does turn a required component into a hard exclusion', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Caminata histórica',
        themes: ['history'],
        components: [
          {
            required: true,
            role: 'stop',
            geoEntity: {
              name: 'Catedral Metropolitana',
              kind: 'PLACE',
            },
          },
        ],
      },
      {
        ...baseIntent,
        hardExclusions: ['religion'],
      },
    );

    expect(result.exclusionMatches).toContain('religion');
  });

  it('falls back softly when hard exclusions empty the candidate set', () => {
    const candidates = [
      {
        canonicalName: 'Parroquia San Telmo',
        themes: ['history', 'religion'],
      },
    ];

    const strictlyFiltered = candidates.filter((candidate) => {
      const evaluation = evaluateExperiencePreferences(candidate, {
        ...baseIntent,
        hardExclusions: ['religion'],
      });
      return evaluation.exclusionMatches.length === 0;
    });

    expect(strictlyFiltered).toHaveLength(0);

    const relaxedSelection = candidates;
    expect(relaxedSelection).toHaveLength(1);
  });
});
