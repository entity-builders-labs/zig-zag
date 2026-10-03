import { composeSet } from './composition-set-cover.util';
import {
  basePortfolioTarget,
  portfolioTarget,
} from './preference-sufficiency.util';
import {
  CompositionCandidate,
  PreferenceSpec,
  facetKey,
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
  it.each([
    {
      name: 'one facet',
      facets: ['theme:history'],
      candidates: [['history', ['theme:history']] as const],
      must: [] as string[],
      days: 1,
      pace: 'relaxed' as const,
    },
    {
      name: 'several facets',
      facets: ['theme:history', 'theme:food'],
      candidates: [
        ['history', ['theme:history']],
        ['food', ['theme:food']],
      ] as const,
      must: [],
      days: 2,
      pace: 'moderate' as const,
    },
    {
      name: 'one Experience covers several facets',
      facets: ['theme:history', 'theme:food'],
      candidates: [['both', ['theme:history', 'theme:food']] as const],
      must: [],
      days: 1,
      pace: 'relaxed' as const,
    },
    {
      name: 'MUST is separate',
      facets: ['theme:history'],
      candidates: [
        ['history', ['theme:history']],
        ['must', []],
      ] as const,
      must: ['must'],
      days: 1,
      pace: 'relaxed' as const,
    },
    {
      name: 'MUST equals reserved id',
      facets: ['theme:history'],
      candidates: [['must-history', ['theme:history']] as const],
      must: ['must-history'],
      days: 1,
      pace: 'relaxed' as const,
    },
    {
      name: 'days times pace dominates',
      facets: ['theme:history'],
      candidates: [['history', ['theme:history']] as const],
      must: [],
      days: 5,
      pace: 'moderate' as const,
    },
    {
      name: 'reservations plus MUST dominate',
      facets: ['theme:history', 'theme:food', 'theme:architecture'],
      candidates: [
        ['history', ['theme:history']],
        ['food', ['theme:food']],
        ['architecture', ['theme:architecture']],
        ['must-a', []],
        ['must-b', []],
        ['must-c', []],
      ] as const,
      must: ['must-a', 'must-b', 'must-c'],
      days: 1,
      pace: 'relaxed' as const,
    },
  ])(
    '$name keeps coverage and composition portfolioTarget identical',
    ({ facets, candidates, must, days, pace }) => {
      const matrixSpec: PreferenceSpec = {
        ...spec,
        facets: facets.map((facet) => {
          const [dimension, key] = facet.split(':');
          return {
            dimension,
            key,
            weight: 1,
            source: 'wizard' as const,
            required: false as const,
          };
        }),
        trip: { days, startDates: [], pace },
      };
      const compositionCandidates = candidates.map(([id, satisfiedFacets]) =>
        candidate(id, [...satisfiedFacets]),
      );
      const result = composeSet({
        candidates: compositionCandidates,
        preferenceSpec: matrixSpec,
        resolvedVenueMustIds: must,
      });
      const reserved = matrixSpec.facets
        .map((facet) => result.perFacetCoverage[facetKey(facet)]?.[0])
        .filter((id): id is string => !!id && !must.includes(id));
      const coverageTarget = portfolioTarget({
        baseTarget: basePortfolioTarget(days, pace),
        reservedStrongExperienceIds: reserved,
        resolvedMustVenueExperienceIds: must,
      });
      expect(result.portfolioTarget).toBe(coverageTarget);
    },
  );

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
        {
          rawName: 'Venue',
          usage: 'specific_destination' as const,
          priority: 'must' as const,
        },
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

  it('exposes candidate-level decisions (reserved/remainder/reservoir/excluded) without recomputing selection', () => {
    const result = composeSet({
      candidates: [
        candidate('history', ['theme:history']),
        candidate('food', ['theme:food']),
        candidate('generic', []),
        candidate('excluded', ['theme:history'], {
          matchesHardExclusion: true,
        }),
      ],
      preferenceSpec: spec,
    });

    const byId = new Map(
      result.decisions.map((decision) => [decision.id, decision]),
    );

    expect(byId.get('history')?.initialSelected).toBe(true);
    expect(byId.get('history')?.reservedForFacets).toContain('theme:history');
    expect(byId.get('food')?.initialSelected).toBe(true);
    expect(byId.get('food')?.reservedForFacets).toContain('theme:food');
    expect(byId.get('generic')?.remainderFill).toBe(true);
    expect(byId.get('generic')?.initialSelected).toBe(true);
    expect(byId.get('excluded')?.eligible).toBe(false);
    expect(byId.get('excluded')?.excluded).toBe(true);
    expect(byId.get('excluded')?.excludedReason).toBe('hard_exclusion');
  });
});
