import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { ExperienceSemanticFacts } from '../interfaces/experience-match-facts.interface';

const facts = (
  overrides: Partial<ExperienceSemanticFacts> = {},
): ExperienceSemanticFacts => ({
  themes: [],
  intents: [],
  dimensionedFacts: [],
  ...overrides,
});

describe('candidateMatchesPreferenceFacet (typed facts only)', () => {
  it('matches a theme target against the typed theme facts only', () => {
    const experience = facts({ themes: ['history', 'art'], intents: ['walk'] });
    expect(
      candidateMatchesPreferenceFacet(experience, {
        dimension: 'theme',
        key: 'history',
      }),
    ).toBe(true);
    expect(
      candidateMatchesPreferenceFacet(experience, {
        dimension: 'theme',
        key: 'walk',
      }),
    ).toBe(false);
  });

  it('matches an intent target against the typed intent facts only', () => {
    const experience = facts({ themes: ['food'], intents: ['visit'] });
    expect(
      candidateMatchesPreferenceFacet(experience, {
        dimension: 'intent',
        key: 'visit',
      }),
    ).toBe(true);
    expect(
      candidateMatchesPreferenceFacet(experience, {
        dimension: 'intent',
        key: 'food',
      }),
    ).toBe(false);
  });

  it('matches every other closed dimension against an explicit dimensioned fact only', () => {
    const experience = facts({
      themes: ['wine'],
      dimensionedFacts: [
        { dimension: 'winery_scale', key: 'boutique' },
        { dimension: 'accessibility', key: 'avoid_stairs' },
      ],
    });
    const target = (dimension: string, key: string) =>
      ({ dimension, key }) as SemanticTarget;
    expect(
      candidateMatchesPreferenceFacet(
        experience,
        target('winery_scale', 'boutique'),
      ),
    ).toBe(true);
    expect(
      candidateMatchesPreferenceFacet(
        experience,
        target('accessibility', 'avoid_stairs'),
      ),
    ).toBe(true);
    // The same key on another dimension is a different fact.
    expect(
      candidateMatchesPreferenceFacet(
        experience,
        target('tourism_intensity', 'boutique'),
      ),
    ).toBe(false);
  });

  it('treats an absent fact as UNKNOWN, never a match', () => {
    expect(
      candidateMatchesPreferenceFacet(facts(), {
        dimension: 'dietary_suitability',
        key: 'vegan',
      }),
    ).toBe(false);
  });
});
