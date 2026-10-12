import { Gap2, GapType2, RouteDecision, SourceClass, Strategy } from './contracts';

/**
 * Versioned acquisition routing policy (design R3). Names source classes and
 * provider adapters only; it contains no website or domain.
 */
export const ROUTING_POLICY_VERSION = 'routing-spike2-1';

export const STRATEGIES = {
  osmAdminAreas: { id: 'osm-admin-areas', sourceClass: 'GEOGRAPHIC_STRUCTURE', provider: 'osm-overpass' },
  osmNamedPlaces: { id: 'osm-named-places', sourceClass: 'GEOGRAPHIC_STRUCTURE', provider: 'osm-overpass' },
  wikidataAreaFacts: { id: 'wikidata-area-facts', sourceClass: 'STRUCTURED_ENTITY_FACTS', provider: 'wikidata-sparql' },
  osmPois: { id: 'osm-pois', sourceClass: 'STRUCTURED_POI', provider: 'osm-overpass' },
  wikidataPlaceFacts: { id: 'wikidata-place-facts', sourceClass: 'STRUCTURED_ENTITY_FACTS', provider: 'wikidata-sparql' },
  osmRoutes: { id: 'osm-routes', sourceClass: 'ROUTE_GEOMETRY', provider: 'osm-overpass' },
  structuredRelevanceFacts: { id: 'structured-relevance-facts', sourceClass: 'STRUCTURED_ENTITY_FACTS', provider: 'catalog-structured-facts' },
  researchMemory: { id: 'research-memory', sourceClass: 'RESEARCH_MEMORY', provider: 'evidence-memory' },
  webEvidence: { id: 'web-evidence', sourceClass: 'WEB_EVIDENCE', provider: 'evaluator-agent' },
} as const satisfies Record<string, Strategy>;

const MEANING_ROUTE: Strategy[] = [STRATEGIES.structuredRelevanceFacts, STRATEGIES.researchMemory, STRATEGIES.webEvidence];

export const ROUTING_TABLE: Record<GapType2, Strategy[]> = {
  AREA_CANDIDATES: [STRATEGIES.osmAdminAreas, STRATEGIES.osmNamedPlaces, STRATEGIES.wikidataAreaFacts],
  PLACE_CANDIDATES: [STRATEGIES.osmPois, STRATEGIES.wikidataPlaceFacts],
  ROUTE_CANDIDATES: [STRATEGIES.osmRoutes],
  AREA_RELEVANCE: MEANING_ROUTE,
  PLACE_RELEVANCE: MEANING_ROUTE,
  WALKING_CORRIDOR_RELEVANCE: MEANING_ROUTE,
  SCHEDULE_CAPACITY: MEANING_ROUTE,
};

/** Source classes each gap kind may ever use (the no-fallback guard). */
export const AUTHORIZED_CLASSES: Record<Gap2['kind'], SourceClass[]> = {
  DISCOVERY: ['GEOGRAPHIC_STRUCTURE', 'STRUCTURED_POI', 'STRUCTURED_ENTITY_FACTS', 'ROUTE_GEOMETRY'],
  MEANING: ['STRUCTURED_ENTITY_FACTS', 'RESEARCH_MEMORY', 'WEB_EVIDENCE'],
  META: ['STRUCTURED_ENTITY_FACTS', 'RESEARCH_MEMORY', 'WEB_EVIDENCE'],
};

export type ProviderAvailability = Readonly<Record<string, boolean>>;

/**
 * Pure routing: gap + provider availability -> ordered strategies. Never adds
 * a class outside the gap kind's authorized classes.
 */
export function routeGap(gap: Gap2, availability: ProviderAvailability): RouteDecision {
  if (gap.kind !== 'DISCOVERY' && gap.questions.length === 0) {
    throw new Error(`meaning gap ${gap.key} routed without offered candidate questions`);
  }
  const allowed = new Set(AUTHORIZED_CLASSES[gap.kind]);
  const table = ROUTING_TABLE[gap.type].filter((s) => allowed.has(s.sourceClass));
  return {
    gapKey: gap.key,
    policyVersion: ROUTING_POLICY_VERSION,
    strategies: table.filter((s) => availability[s.provider] !== false),
    unavailable: table.filter((s) => availability[s.provider] === false),
  };
}

export interface StrategyRun {
  strategyId: string;
  sourceClass: SourceClass;
  outcome: 'SUCCESS' | 'EMPTY' | 'FAILED' | 'SKIPPED';
  detail?: string;
  providerCalls?: Record<string, number>;
}

export interface RouteTrace {
  gapKey: string;
  gapType: GapType2;
  policyVersion: string;
  selected: string[];
  unavailable: string[];
  runs: StrategyRun[];
}

export function newRouteTrace(gap: Gap2, decision: RouteDecision): RouteTrace {
  return {
    gapKey: gap.key,
    gapType: gap.type,
    policyVersion: decision.policyVersion,
    selected: decision.strategies.map((s) => s.id),
    unavailable: decision.unavailable.map((s) => s.id),
    runs: [],
  };
}
