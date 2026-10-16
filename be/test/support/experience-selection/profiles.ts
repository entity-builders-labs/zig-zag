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

/**
 * A former open "trait" preference. Since task 25.4 an open concept has no
 * shared typed identity, so the extractor reports it as an unresolved
 * concept that never participates in matching.
 */
const openConcept = (
  label: string,
  evidence: string = label.replace(/_/g, ' '),
): FakeInterpretation['unresolvedConcepts'][number] => ({
  label,
  polarity: 'INCLUDE',
  constraint: 'SOFT',
  evidence: [evidence],
});

/** A hard exclusion of a concept with no shared typed identity. */
const hardExcludedConcept = (
  label: string,
  evidence: string,
): FakeInterpretation['unresolvedConcepts'][number] => ({
  label,
  polarity: 'EXCLUDE',
  constraint: 'HARD',
  evidence: [evidence],
});

export interface Variant {
  name: string;
  request: Record<string, unknown>;
  interpretation: FakeInterpretation;
  /** Optional diagnostic cluster; acceptance is directional, not exclusive. */
  expectDominantCluster?: string;
  /** A typed terminal outcome instead of a completed Tour. */
  expectOutcome?: 'HARD_CONSTRAINT_UNENFORCEABLE';
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
  unresolvedConcepts?: FakeInterpretation['unresolvedConcepts'];
  expectDominantCluster?: string;
  /** A typed terminal outcome instead of a completed Tour. */
  expectOutcome?: 'HARD_CONSTRAINT_UNENFORCEABLE';
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
      unresolvedConcepts: spec.unresolvedConcepts ?? [],
      positiveSemanticQuery: spec.semanticQuery,
    },
    expectDominantCluster: spec.expectDominantCluster,
    expectOutcome: spec.expectOutcome,
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
      unresolvedConcepts: [
        openConcept('local', 'local'),
        openConcept('craft_beer', 'craft beer'),
      ],
      expectDominantCluster: 'craft_beer_crawl',
      requestedFacetKeys: ['food', 'walk', 'local', 'craft_beer'],
    }),
    mkVariant({
      name: '2B-specialty-coffee',
      interests: ['food'],
      semanticQuery: 'specialty coffee tasting tour, local roasters and cafes',
      unresolvedConcepts: [
        openConcept('local', 'local'),
        openConcept('specialty_coffee', 'specialty coffee'),
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
      unresolvedConcepts: [openConcept('local_guide', 'local guide')],
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
      unresolvedConcepts: [hardExcludedConcept('religion', 'no churches')],
      // Task 25.4/25.7: "religion" has no shared typed identity and the catalog
      // records no target knowledge, so no Experience can be
      // proven compatible: generation ends with the typed outcome instead
      // of a lexical exclusion guess.
      expectOutcome: 'HARD_CONSTRAINT_UNENFORCEABLE',
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
