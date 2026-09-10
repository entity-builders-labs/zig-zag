import { SourceObservation } from '../../../src/modules/tours/interfaces/experience-acquisition.interface';

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
    standaloneEligible: true,
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
 * OSM evidence that is FACTUALLY equivalent to `tourism_intensity: iconic`
 * (a heavily-visited, well-known place) and to `tourism_intensity: hidden`
 * / `local_character: authentic` (an off-the-beaten-path local place). The
 * providers do not currently emit a dimensioned facet for either; the tags
 * here are the raw objective signal.
 */
export function osmIconicPlaceObservation(): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:node:333333',
    evidenceKey: 'osm:node:333333',
    title: 'Iconic City Landmark',
    description:
      'A nationally iconic, heavily visited landmark (wikipedia + wikidata, high visitor volume).',
    geo: { latitude: -32.9476, longitude: -60.6285 },
    evidenceType: 'place',
    metadata: {
      osmType: 'node',
      osmTags: {
        name: 'Iconic City Landmark',
        tourism: 'attraction',
        historic: 'monument',
        wikidata: 'Q9999999',
        wikipedia: 'es:Iconic City Landmark',
      },
      matchedConcepts: ['historic'],
    },
  };
}

export function osmHiddenLocalPlaceObservation(): SourceObservation {
  return {
    provider: 'osm',
    externalId: 'osm:node:444444',
    evidenceKey: 'osm:node:444444',
    title: 'Neighbourhood Passage',
    description:
      'A quiet residential passage known mostly to locals, no wikidata, low visitor volume.',
    geo: { latitude: -32.94, longitude: -60.66 },
    evidenceType: 'place',
    metadata: {
      osmType: 'node',
      osmTags: {
        name: 'Neighbourhood Passage',
        tourism: 'attraction',
        'addr:suburb': 'Barrio Martin',
      },
      matchedConcepts: ['historic'],
    },
  };
}
