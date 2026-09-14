import { composeSet } from './composition-set-cover.util';
import {
  CompositionCandidate,
  PreferenceSpec,
} from '../interfaces/preference-spec.interface';
import { ExplorationSignals } from './exploration-signals.util';

const signals: ExplorationSignals = {
  prominence: { value: null, confidence: 0, evidence: [], reasonCodes: [] },
  tourismIntensity: {
    value: null,
    confidence: 0,
    evidence: [],
    reasonCodes: [],
  },
  localCharacter: { value: null, confidence: 0, evidence: [], reasonCodes: [] },
};
const spec: PreferenceSpec = {
  facets: [
    {
      dimension: 'theme',
      key: 'history',
      weight: 1,
      source: 'wizard',
      required: false,
    },
    {
      dimension: 'theme',
      key: 'food',
      weight: 0.2,
      source: 'wizard',
      required: false,
    },
  ],
  exclusions: { themes: [], traits: [], hard: [] },
  anchors: [],
  semanticQuery: '',
  explorationStyle: 'balanced',
  softConstraints: { dietary: [], accessibility: [], budget: [], group: [] },
  trip: { days: 1, startDates: [], pace: 'relaxed' },
};
function candidate(
  id: string,
  facets: string[],
  overrides: Partial<CompositionCandidate> = {},
): CompositionCandidate {
  return {
    id,
    componentCount: 1,
    satisfiedFacets: facets,
    qualityScore: 4,
    explorationSignals: signals,
    explorationTilt: 0,
    semanticSimilarity: 0,
    groundingStrength: 1,
    matchesHardExclusion: false,
    softAnchorBoost: 0,
    isPerformanceVenue: false,
    ...overrides,
  };
}

describe('composeSet', () => {
  it('reserves strong requested facets before weighted fill and retains a reservoir', () => {
    const result = composeSet({
      candidates: [
        candidate('history', ['theme:history']),
        candidate('food', ['theme:food']),
        candidate('generic', []),
      ],
      preferenceSpec: spec,
    });
    expect(result.selected).toContain('history');
    expect(result.selected).toContain('food');
    expect(result.reservoir).toEqual([]);
    expect(result.portfolioTarget).toBe(3);
  });

  it('does not allow semantic similarity to create coverage and is deterministic', () => {
    const input = {
      candidates: [
        candidate('semantic-only', [], { semanticSimilarity: 0.99 }),
        candidate('history', ['theme:history']),
      ],
      preferenceSpec: spec,
    };
    const first = composeSet(input);
    expect(first.perFacetCoverage['theme:history']).toEqual(['history']);
    expect(first.unmetFacets).toContain('theme:food');
    expect(composeSet(input)).toEqual(first);
  });

  it('drops hard exclusions before reservation and forces resolved venue must ids', () => {
    const mustSpec = {
      ...spec,
      anchors: [
        { rawName: 'Venue', kind: 'venue' as const, priority: 'must' as const },
      ],
    };
    const result = composeSet({
      candidates: [
        candidate('excluded', ['theme:history'], {
          matchesHardExclusion: true,
        }),
        candidate('venue', []),
      ],
      preferenceSpec: mustSpec,
      resolvedVenueMustIds: ['venue'],
      resolvedVenueMustAnchorNames: ['Venue'],
    });
    expect(result.selected).toContain('venue');
    expect(result.selected).not.toContain('excluded');
    expect(result.mustAnchorsForced).toEqual(['venue']);
    expect(result.unmetAnchors).toEqual([]);
  });
});
