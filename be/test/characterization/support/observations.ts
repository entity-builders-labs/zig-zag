import { SourceObservation } from '../../../src/modules/tours/interfaces/experience-acquisition.interface';

const PLACE_ORIGINATION_CAPABILITIES = [
  'GENERAL_TOURISM_EXPERIENCE',
  'SINGLE_PLACE',
] as const;

/**
 * Deterministic structured-provider observations carrying OBJECTIVE factual
 * evidence (OSM tags, Google Places types) — nothing derived from any user
 * query. Used to characterize whether that factual semantics survives into the
 * persisted Experience.
 */

export function osmHistoricMonumentObservation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:node:111111',
    evidenceKey: 'osm:node:111111',
    title: 'Monumento Histórico',
    description: 'A historic monument recorded in OpenStreetMap.',
    geo: { latitude: -32.9475, longitude: -60.6284 },
    evidenceType: 'place',
    originationCapabilities: [...PLACE_ORIGINATION_CAPABILITIES],
    metadata: {
      osmType: 'node',
      osmTags: {
        name: 'Monumento Histórico',
        historic: 'monument',
        tourism: 'attraction',
        wikidata: 'Q1234567',
      },
      matchedConcepts: ['historic'],
    },
    ...overrides,
  };
}

export function osmArtMuseumObservation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:way:222222',
    evidenceKey: 'osm:way:222222',
    title: 'Museo de Bellas Artes',
    description: 'A fine-arts museum recorded in OpenStreetMap.',
    geo: { latitude: -32.9333, longitude: -60.6417 },
    evidenceType: 'place',
    originationCapabilities: [...PLACE_ORIGINATION_CAPABILITIES],
    metadata: {
      osmType: 'way',
      osmTags: {
        name: 'Museo de Bellas Artes',
        tourism: 'museum',
        museum: 'art',
      },
      matchedConcepts: ['museum'],
    },
    ...overrides,
  };
}

export function placesHistoricalLandmarkObservation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    provider: 'google_places',
    externalId: 'places:ChIJhistoricallandmark',
    evidenceKey: 'places:ChIJhistoricallandmark',
    title: 'Historical Landmark',
    description: 'A historical landmark returned by Google Places.',
    geo: { latitude: -32.945, longitude: -60.63 },
    evidenceType: 'place',
    originationCapabilities: [...PLACE_ORIGINATION_CAPABILITIES],
    metadata: {
      primaryType: 'historical_landmark',
      types: ['historical_landmark', 'tourist_attraction'],
      rating: 4.7,
      userRatingCount: 5321,
    },
    ...overrides,
  };
}

/**
 * Two neutral structured observations. These carry only raw provider tags —
 * NO claim is made that any of these tags proves a product facet such as
 * `tourism_intensity: iconic` or `local_character: authentic`. They exist to
 * exercise the plumbing (does ANY structured facet reach the persisted
 * Experience?), not to assert a tag→facet mapping.
 *
 * `structuredLandmarkAObservation` has `wikidata` + `wikipedia`; the absence of
 * those on `structuredPlaceBObservation` is deliberately NOT treated as
 * evidence of "hidden" / "local" — it is just a second, differently-tagged
 * place.
 */
export function structuredLandmarkAObservation(): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:node:333333',
    evidenceKey: 'osm:node:333333',
    title: 'Structured Landmark A',
    description:
      'A place recorded in OpenStreetMap with wikidata/wikipedia tags.',
    geo: { latitude: -32.9476, longitude: -60.6285 },
    evidenceType: 'place',
    originationCapabilities: [...PLACE_ORIGINATION_CAPABILITIES],
    metadata: {
      osmType: 'node',
      osmTags: {
        name: 'Structured Landmark A',
        tourism: 'attraction',
        historic: 'monument',
        wikidata: 'Q9999999',
        wikipedia: 'es:Structured Landmark A',
      },
      matchedConcepts: ['historic'],
    },
  };
}

export function structuredPlaceBObservation(): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:node:444444',
    evidenceKey: 'osm:node:444444',
    title: 'Structured Place B',
    description: 'A place recorded in OpenStreetMap with a minimal tag set.',
    geo: { latitude: -32.94, longitude: -60.66 },
    evidenceType: 'place',
    originationCapabilities: [...PLACE_ORIGINATION_CAPABILITIES],
    metadata: {
      osmType: 'node',
      osmTags: {
        name: 'Structured Place B',
        tourism: 'attraction',
        'addr:suburb': 'Barrio Martin',
      },
      matchedConcepts: ['historic'],
    },
  };
}

/**
 * SYNTHETIC CONTROLLED EVIDENCE — not produced by any provider. Used only to
 * exercise `candidateMatchesPreferenceFacet` matcher semantics for
 * `exploration_style`, which requires explicit dimensioned evidence
 * (`metadata.dimensionedTraits` / `metadata.preferenceFacets` /
 * `metadata.dimensions`). The value here is hand-authored, not inferred from
 * any raw tag.
 */
export function syntheticDimensionedExperience(
  dimension: string,
  key: string,
): Record<string, unknown> {
  return {
    canonicalName: 'Synthetic Dimensioned Experience',
    themes: [] as string[],
    traits: [] as string[],
    intents: [] as string[],
    metadata: {
      dimensionedTraits: [{ dimension, key }],
    },
  };
}
