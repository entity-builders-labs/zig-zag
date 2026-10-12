import { TransportationMode, TravelPace } from '../../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { DestinationResolution } from '../../../../be/src/modules/tours/services/destination-resolution.service';
import {
  Assertion,
  AssertionSubject,
  ClaimType,
  EvidenceCapture,
  GeoEntityRef,
  InterpretedRequest,
} from '../../src/contracts';
import { assertionKey } from '../../src/keys';
import { CatalogStore, GeographyResolutionAuthority, GroundingAuthority } from '../../src/stores';

/**
 * Hand-authored fixture world (clearly synthetic geometry, real-ish
 * coordinates around San Telmo). Used only by unit tests; live runs use
 * real providers.
 */
const square = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] as [number, number][][],
});

const place = (id: string, name: string, lng: number, lat: number): GeoEntityRef => ({
  id, kind: 'PLACE', name, identities: [{ provider: 'osm', externalId: `osm:node:${id}` }],
  geometry: { type: 'Point', coordinates: [lng, lat] }, centroid: { lng, lat },
});

export const DEST_ID = 'geo-caba';

export const ENTITIES: Record<string, GeoEntityRef> = {
  [DEST_ID]: {
    id: DEST_ID, kind: 'AREA', name: 'Ciudad Autónoma de Buenos Aires',
    identities: [{ provider: 'osm', externalId: 'osm:relation:fixture-caba' }],
    geometry: square(-58.53, -34.71, -58.33, -34.53), centroid: { lng: -58.43, lat: -34.62 },
  },
  'geo-san-telmo': {
    id: 'geo-san-telmo', kind: 'AREA', name: 'San Telmo',
    identities: [{ provider: 'osm', externalId: 'osm:relation:fixture-san-telmo' }],
    geometry: square(-58.38, -34.628, -58.365, -34.612), centroid: { lng: -58.3725, lat: -34.62 },
  },
  'geo-recoleta': {
    id: 'geo-recoleta', kind: 'AREA', name: 'Recoleta',
    identities: [{ provider: 'osm', externalId: 'osm:relation:fixture-recoleta' }],
    geometry: square(-58.405, -34.595, -58.38, -34.58), centroid: { lng: -58.3925, lat: -34.5875 },
  },
  'geo-defensa': {
    id: 'geo-defensa', kind: 'ROUTE', name: 'Defensa',
    identities: [{ provider: 'osm', externalId: 'osm:way:fixture-defensa' }],
    geometry: {
      type: 'LineString',
      coordinates: [[-58.3720, -34.6080], [-58.3718, -34.6120], [-58.3716, -34.6160], [-58.3716, -34.6205], [-58.3714, -34.6250], [-58.3712, -34.6290]],
    },
    centroid: { lng: -58.3716, lat: -34.6185 },
  },
  'geo-plaza-de-mayo': place('geo-plaza-de-mayo', 'Plaza de Mayo', -58.3725, -34.6083),
  'geo-parque-lezama': place('geo-parque-lezama', 'Parque Lezama', -58.3700, -34.6286),
  'geo-plaza-dorrego': place('geo-plaza-dorrego', 'Plaza Dorrego', -58.3716, -34.6206),
  'geo-mercado-san-telmo': place('geo-mercado-san-telmo', 'Mercado de San Telmo', -58.3726, -34.6211),
  'geo-cementerio-recoleta': place('geo-cementerio-recoleta', 'Cementerio de la Recoleta', -58.3933, -34.5875),
};

export const capture = (url: string, text: string): EvidenceCapture => ({
  id: `${url}#${text}`,
  locator: { kind: 'URL', url },
  retrievedAt: '2026-10-10T00:00:00Z',
  contentFingerprint: 'fixture',
  capture: { kind: 'PROSE_SPAN', start: 0, end: text.length, text },
  registrableDomain: new URL(url).hostname,
  provenanceSignals: [],
  supportVerdicts: [],
});

export function fixtureAssertion(claimType: ClaimType, subject: AssertionSubject, facetKey: string, url = 'https://editorial.example/x'): Assertion {
  return {
    key: assertionKey(claimType, subject, facetKey),
    claimType, subject, facetKey, destinationId: DEST_ID,
    evidence: [capture(url, `${claimType} ${facetKey}`)],
    status: 'ACTIVE', createdAt: '2026-10-10T00:00:00Z',
  };
}

export function worldStore(entityIds: string[] = Object.keys(ENTITIES)): CatalogStore {
  const store = new CatalogStore();
  const token = new GeographyResolutionAuthority();
  for (const id of entityIds) store.recordGeoEntity(token, ENTITIES[id]);
  return store;
}

export const grounding = new GroundingAuthority();

export const DEFENSA_STATED = {
  routeGeoEntityId: 'geo-defensa',
  from: { kind: 'GEO_ENTITY' as const, geoEntityId: 'geo-plaza-de-mayo' },
  to: { kind: 'GEO_ENTITY' as const, geoEntityId: 'geo-parque-lezama' },
  boundKind: 'STATED_ANCHORS' as const,
};

export const DEFENSA_CLIP = {
  routeGeoEntityId: 'geo-defensa',
  from: { kind: 'AREA_CLIP' as const, areaGeoEntityId: 'geo-san-telmo' },
  to: { kind: 'AREA_CLIP' as const, areaGeoEntityId: 'geo-san-telmo' },
  boundKind: 'AREA_CLIP' as const,
};

/** "Buenos Aires, 4 days, history, food, walking" with explicit wizard mobility. */
export const REQUEST_A: InterpretedRequest = {
  destinationLabel: 'Buenos Aires',
  days: 4,
  thematicFacets: ['theme:food', 'theme:history'],
  experienceFormatFacets: ['intent:walk'],
  mobility: {
    allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT],
    maxWalkingDistancePerDayMeters: 8000,
    maxContinuousWalkingDistanceMeters: 3000,
    travelPace: TravelPace.MODERATE,
    accessibilityNeeds: [],
  },
};

export const FIXTURE_DESTINATION: DestinationResolution = {
  scale: 'area',
  boundary: {
    id: 'osm:relation:fixture-caba', name: 'Ciudad Autónoma de Buenos Aires', osmType: 'relation', osmId: 1,
    geometry: square(-58.53, -34.71, -58.33, -34.53), tags: {},
  },
  attemptedQueries: ['fixture'],
};
