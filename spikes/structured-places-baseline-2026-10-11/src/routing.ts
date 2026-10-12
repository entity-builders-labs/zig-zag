import { GapClass3, GapType3 } from './readiness';

/**
 * Revision 3 routing policy (design S6): cheapest sufficient authority; no
 * research strategy for any core gap. Names source classes and adapters only.
 */
export const ROUTING_POLICY_3 = 'routing-spike3-1';

export interface Strategy3 {
  id: string;
  sourceClass: 'STRUCTURED_POI' | 'STRUCTURED_ENTITY_FACTS' | 'RESEARCH_MEMORY' | 'WEB_EVIDENCE';
  provider: string;
}

const STRUCTURED_POI: Strategy3 = { id: 'osm-pois-destination', sourceClass: 'STRUCTURED_POI', provider: 'osm-overpass' };
const WIKIDATA_FACTS: Strategy3 = { id: 'wikidata-place-facts', sourceClass: 'STRUCTURED_ENTITY_FACTS', provider: 'wikidata-sparql' };
const SEMANTIC: Strategy3[] = [
  { id: 'structured-relevance-facts', sourceClass: 'STRUCTURED_ENTITY_FACTS', provider: 'catalog-structured-facts' },
  { id: 'research-memory', sourceClass: 'RESEARCH_MEMORY', provider: 'evidence-memory' },
  { id: 'web-evidence', sourceClass: 'WEB_EVIDENCE', provider: 'evaluator-agent' },
];

/**
 * Spike 3 provider set (owner decision Q2): local OSM + Wikidata facts. Later
 * policy versions may add Overture / Geoapify / Google Places as further
 * STRUCTURED_POI strategies for SCHEDULE_CAPACITY.
 */
export const ROUTING_TABLE_3: Record<GapType3, Strategy3[]> = {
  PLACE_CANDIDATES: [STRUCTURED_POI, WIKIDATA_FACTS],
  SCHEDULE_CAPACITY: [],
  AREA_RELEVANCE: SEMANTIC,
  PLACE_RELEVANCE: SEMANTIC,
  WALKING_CORRIDOR_RELEVANCE: SEMANTIC,
};

const RESEARCH = new Set(['RESEARCH_MEMORY', 'WEB_EVIDENCE']);

export function route3(type: GapType3, gapClass: GapClass3): Strategy3[] {
  const strategies = ROUTING_TABLE_3[type];
  if (gapClass === 'CORE' && strategies.some((s) => RESEARCH.has(s.sourceClass))) {
    throw new Error(`routing invariant violated: research strategy on core gap ${type}`);
  }
  return strategies;
}

/** Structured strategies that could still add place candidates (none beyond the destination POI query in spike 3). */
export function structuredStrategiesRemaining(executed: Set<string>): string[] {
  return [...ROUTING_TABLE_3.PLACE_CANDIDATES, ...ROUTING_TABLE_3.SCHEDULE_CAPACITY]
    .filter((s) => s.sourceClass === 'STRUCTURED_POI' && !executed.has(s.id))
    .map((s) => s.id);
}
