import { ExperienceDiscoveryRequest } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { ExperienceGroundedSearchResult } from 'src/modules/tours/interfaces/experience-grounding.interface';

export interface LiveDiscoveryScenario {
  name: string;
  request: ExperienceDiscoveryRequest;
  evidence: ExperienceGroundedSearchResult;
  /** Only used by the generic-entity scenario. */
  bannedPlaceNames?: string[];
}

function grounded(
  evidence: ExperienceGroundedSearchResult['evidence'],
): ExperienceGroundedSearchResult {
  return {
    provider: 'fixture',
    model: 'static',
    groundingStatus: 'applied',
    evidence,
  };
}

/**
 * Scenario 1 — controlled facets. A historic/architectural walking route through
 * central Buenos Aires with several concretely named stops.
 */
export const controlledScenario: LiveDiscoveryScenario = {
  name: 'controlled-facets',
  request: {
    scope: { destinationName: 'Buenos Aires' },
    requestedThemes: ['history', 'architecture'],
    requestedIntents: ['walk'],
    breadth: 'focused',
    maxCandidates: 5,
  },
  evidence: grounded([
    {
      key: 'ev-hist-1',
      source: 'buenosaires.gob.ar',
      title: 'Casco Historico walking route',
      snippet:
        'A classic self-guided walk through the historic core of Buenos Aires starts at Plaza de Mayo, the civic heart of the city. Facing the square are the Casa Rosada, the seat of government, and the Cabildo, the colonial town hall preserved as a museum. From Plaza de Mayo the route follows Avenida de Mayo, a broad avenue lined with early twentieth century architecture, west toward Congreso.',
    },
    {
      key: 'ev-hist-2',
      source: 'turismo.buenosaires.gob.ar',
      title: 'Avenida de Mayo landmarks',
      snippet:
        'Along Avenida de Mayo the standout building is Palacio Barolo, an eclectic 1923 tower inspired by the Divine Comedy, open for guided visits to its lighthouse. The avenue also passes the historic Cafe Tortoni. The walk is flat, about 1.5 kilometres, and takes roughly ninety minutes at a relaxed pace with stops.',
    },
  ]),
};

/**
 * Scenario 2 — long-tail concepts with real backing businesses so allowed
 * componentHints have a concrete entity.
 */
export const longTailScenario: LiveDiscoveryScenario = {
  name: 'long-tail',
  request: {
    scope: { destinationName: 'Buenos Aires' },
    requestedThemes: ['food'],
    requestedIntents: ['route_like'],
    semanticQuery:
      'craft beer, small local breweries, specialty coffee, local places',
    breadth: 'focused',
    maxCandidates: 5,
  },
  evidence: grounded([
    {
      key: 'ev-lt-1',
      source: 'timeout.com/buenos-aires',
      title: 'Palermo craft beer and coffee crawl',
      snippet:
        'Palermo is the centre of the Buenos Aires craft beer scene. Strange Brewing on Nicaragua street is a small independent brewery and taproom pouring its own beers. A few blocks away, LAB Tostadores de Cafe is a well known specialty coffee roastery and cafe. The two make an easy afternoon route on foot through the Palermo Soho grid.',
    },
    {
      key: 'ev-lt-2',
      source: 'clarin.com',
      title: 'Small breweries of Buenos Aires',
      snippet:
        'Beyond the big names, the city has dozens of small local breweries and neighbourhood taprooms, most concentrated in Palermo and Villa Crespo. Prices are low and the beer is fresh. Pair a visit with one of the many independent specialty coffee shops that have opened in the same barrios.',
    },
  ]),
};

/**
 * Scenario 3 — generic-entity hallucination probe. Evidence names a real AREA
 * (Palermo) but NO concrete cafe or brewery. A `PLACE` componentHint named
 * after a bare category would be a fabricated pseudo-entity.
 */
export const genericEntityScenario: LiveDiscoveryScenario = {
  name: 'generic-entity-probe',
  request: {
    scope: { destinationName: 'Buenos Aires' },
    requestedThemes: ['food'],
    requestedIntents: ['walk'],
    semanticQuery: 'specialty coffee, craft beer',
    breadth: 'focused',
    maxCandidates: 5,
  },
  evidence: grounded([
    {
      key: 'ev-ge-1',
      source: 'nytimes.com/travel',
      title: 'A weekend in Palermo',
      snippet:
        'Palermo, the largest barrio in Buenos Aires, has in recent years filled with independent specialty coffee shops and many small craft breweries. Wander the leafy streets of Palermo Soho and Palermo Hollywood and you will pass one after another. The article does not single out a specific cafe or brewery by name; the pleasure is in stumbling on them yourself.',
    },
  ]),
  bannedPlaceNames: [
    'specialty coffee shop',
    'specialty coffee shops',
    'coffee shop',
    'coffee place',
    'craft brewery',
    'craft breweries',
    'small craft brewery',
    'local brewery',
    'craft beer bar',
    'wine store',
    'historic restaurant',
  ],
};

export const ALL_SCENARIOS = [
  controlledScenario,
  longTailScenario,
  genericEntityScenario,
];
