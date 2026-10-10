import { emptyInterpretation, FakeInterpretation } from './fakes';

const ORIGIN = { latitude: -34.6037, longitude: -58.3816 };

export function baseRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    destination: {
      label: 'Obelisco, Buenos Aires',
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      radiusMeters: 3000,
      scaleHint: 'specific_point',
    },
    days: 1,
    budgetLevel: 'medium',
    groupType: 'friends',
    intent: {
      interests: [] as string[],
      intents: [] as string[],
      explorationStyle: 'balanced',
      additionalPreferences: '',
    },
    mobility: {
      allowedTransportationModes: ['walking'],
      maxWalkingDistancePerDayMeters: 12000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate',
      accessibilityNeeds: [] as string[],
    },
    dietaryRestrictions: [] as string[],
    startDates: ['2026-09-07'],
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [] as string[],
    categories: [] as string[],
    ...overrides,
  };
}

const traitFacet = (
  key: string,
  evidence: string = key.replace(/_/g, ' '),
) => ({
  dimension: 'trait',
  key,
  confidence: 1,
  strength: 'strong' as const,
  evidence: [evidence],
});

export interface Variant {
  name: string;
  request: Record<string, unknown>;
  interpretation: FakeInterpretation;
  /** Optional diagnostic cluster; acceptance is directional, not exclusive. */
  expectDominantCluster?: string;
  /** Bare facet keys the profile requests — for the dominance helper. */
  requestedFacetKeys: string[];
}

export interface Counterfactual {
  key: string;
  title: string;
  variants: Variant[];
}

interface VariantSpec {
  name: string;
  interests: string[];
  intents?: string[];
  explorationStyle?: 'iconic' | 'local_deep_dive' | 'balanced';
  /** Free-text the "user typed" — also becomes the semantic query's 3rd line. */
  semanticQuery: string;
  extraFacets?: FakeInterpretation['preferredFacets'];
  hardExclusions?: string[];
  expectDominantCluster?: string;
  requestedFacetKeys: string[];
}

/**
 * `PreferenceInterpreterService.interpret` short-circuits to EMPTY_INTENT when
 * `additionalPreferences` is blank (the fake LangChain is never called), so
 * every variant passes a non-empty `additionalPreferences`. The service then
 * overwrites it with `positiveSemanticQuery` before building the semantic
 * query, so the two are kept identical here.
 */
function mkVariant(spec: VariantSpec): Variant {
  return {
    name: spec.name,
    request: baseRequest({
      intent: {
        interests: spec.interests,
        intents: spec.intents ?? ['walk'],
        explorationStyle: spec.explorationStyle ?? 'balanced',
        additionalPreferences: spec.semanticQuery,
      },
    }),
    interpretation: {
      ...emptyInterpretation(),
      preferredFacets: spec.extraFacets ?? [],
      hardExclusions: spec.hardExclusions ?? [],
      positiveSemanticQuery: spec.semanticQuery,
    },
    expectDominantCluster: spec.expectDominantCluster,
    requestedFacetKeys: spec.requestedFacetKeys,
  };
}

const CF1: Counterfactual = {
  key: 'iconic-vs-local',
  title:
    'CF1 — iconic vs local deep dive (only explorationStyle + query differ)',
  variants: [
    mkVariant({
      name: '1A-iconic',
      interests: ['history', 'architecture'],
      explorationStyle: 'iconic',
      semanticQuery:
        'iconic must-see landmarks and famous historic architecture',
      expectDominantCluster: 'iconic_history_arch',
      requestedFacetKeys: ['history', 'architecture', 'walk'],
    }),
    mkVariant({
      name: '1B-local',
      interests: ['history', 'architecture'],
      explorationStyle: 'local_deep_dive',
      semanticQuery:
        'hidden history in local neighborhoods, offbeat residential streets',
      expectDominantCluster: 'hidden_history_arch',
      requestedFacetKeys: [
        'history',
        'architecture',
        'walk',
        'exploration_style:local_deep_dive',
      ],
    }),
  ],
};

const CF2: Counterfactual = {
  key: 'craft-beer-vs-coffee',
  title:
    'CF2 — craft beer vs specialty coffee (only the added trait + query differ)',
  variants: [
    mkVariant({
      name: '2A-craft-beer',
      interests: ['food'],
      semanticQuery: 'craft beer crawl through local breweries and taprooms',
      extraFacets: [
        traitFacet('local', 'local'),
        traitFacet('craft_beer', 'craft beer'),
      ],
      expectDominantCluster: 'craft_beer_crawl',
      requestedFacetKeys: ['food', 'walk', 'local', 'craft_beer'],
    }),
    mkVariant({
      name: '2B-specialty-coffee',
      interests: ['food'],
      semanticQuery: 'specialty coffee tasting tour, local roasters and cafes',
      extraFacets: [
        traitFacet('local', 'local'),
        traitFacet('specialty_coffee', 'specialty coffee'),
      ],
      expectDominantCluster: 'specialty_coffee_tour',
      requestedFacetKeys: ['food', 'walk', 'local', 'specialty_coffee'],
    }),
  ],
};

const CF3: Counterfactual = {
  key: 'exact-fit-vs-quality',
  title:
    'CF3 — exact fit (q~4.3, all facets) vs generic 5-star (q~5.0, fewer facets)',
  variants: [
    mkVariant({
      name: '3-only',
      interests: ['history', 'architecture'],
      semanticQuery: 'small-group local guide, historic architecture walk',
      extraFacets: [traitFacet('local_guide', 'local guide')],
      expectDominantCluster: 'exact_fit_history',
      requestedFacetKeys: ['history', 'architecture', 'walk', 'local_guide'],
    }),
  ],
};

const CF4: Counterfactual = {
  key: 'hard-exclusion',
  title: 'CF4 — hard exclusion (religion) inside the shared corpus',
  variants: [
    mkVariant({
      name: '4-only',
      interests: ['history', 'architecture'],
      semanticQuery: 'secular historic architecture walking tour, no churches',
      hardExclusions: ['religion'],
      // Any non-religion history+architecture cluster is acceptable — the
      // assertion is about the EXCLUSION, not which secular cluster wins.
      requestedFacetKeys: ['history', 'architecture', 'walk'],
    }),
  ],
};

const CF5: Counterfactual = {
  key: 'one-preference-delta',
  title: 'CF5 — one added facet (tango) shifts the itinerary',
  variants: [
    mkVariant({
      name: '5B-baseline',
      interests: ['history', 'architecture'],
      semanticQuery: 'historic architecture walking tour',
      requestedFacetKeys: ['history', 'architecture', 'walk'],
    }),
    mkVariant({
      name: '5A-plus-tango',
      interests: ['history', 'architecture', 'tango'],
      semanticQuery: 'historic architecture walking tour with tango',
      expectDominantCluster: 'history_tango',
      requestedFacetKeys: ['history', 'architecture', 'tango', 'walk'],
    }),
  ],
};

export const COUNTERFACTUALS: Counterfactual[] = [CF1, CF2, CF3, CF4, CF5];
