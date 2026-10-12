import { OsmCandidate } from '../../../../be/src/modules/integrations/osm/services/osm-places.service';
import { TransportationMode, TravelPace } from '../../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { DestinationResolution } from '../../../../be/src/modules/tours/services/destination-resolution.service';
import { OsmRecord, OsmStructuredAdapter, StructuredProviderFailure, WikidataFacts, WikidataFactsAdapter } from '../../src/adapters/structured';
import { GeoEntityRef, IdentityResult, InterpretedRequest, OsmGeoResolver } from '../../src/spike1';

/** Hand-authored synthetic world around San Telmo (unit tests only). */
export const square = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] as [number, number][][],
});

export const CABA: OsmCandidate = { id: 'osm:relation:1224652', name: 'Buenos Aires', osmType: 'relation', osmId: 1224652, geometry: square(-58.53, -34.71, -58.33, -34.53), tags: {} };
export const DEST: GeoEntityRef = {
  id: 'geo:osm:relation:1224652', kind: 'AREA', name: 'Buenos Aires', identities: [{ provider: 'openstreetmap', externalId: CABA.id }],
  geometry: square(-58.53, -34.71, -58.33, -34.53), centroid: { lng: -58.43, lat: -34.62 },
};

export const BOUNDARIES: Record<string, OsmCandidate> = {
  'relation/2223069': { id: 'osm:relation:2223069', name: 'San Telmo', osmType: 'relation', osmId: 2223069, geometry: square(-58.38, -34.628, -58.365, -34.612), tags: {} },
  'relation/2223070': { id: 'osm:relation:2223070', name: 'Recoleta', osmType: 'relation', osmId: 2223070, geometry: square(-58.405, -34.595, -58.38, -34.58), tags: {} },
  'way/31364659': { id: 'osm:way:31364659', name: 'Plaza Dorrego', osmType: 'way', osmId: 31364659, geometry: square(-58.3720, -34.6208, -58.3713, -34.6202), tags: {} },
  'way/17441757': { id: 'osm:way:17441757', name: 'Parque Lezama', osmType: 'way', osmId: 17441757, geometry: square(-58.3712, -34.6292, -58.3675, -34.6254), tags: {} },
};

export const ADMIN: OsmRecord[] = [
  { externalId: 'osm:relation:2223069', osmType: 'relation', osmId: 2223069, name: 'San Telmo', tags: { wikidata: 'Q1034165' }, center: { lat: -34.62, lng: -58.372 } },
  { externalId: 'osm:relation:2223070', osmType: 'relation', osmId: 2223070, name: 'Recoleta', tags: { wikidata: 'Q1050240' }, center: { lat: -34.5875, lng: -58.3925 } },
];

export const NAMED: OsmRecord[] = [
  { externalId: 'osm:node:9001', osmType: 'node', osmId: 9001, name: 'Palermo Soho', tags: { place: 'neighbourhood', wikidata: 'Q7128049' }, center: { lat: -34.588, lng: -58.43 } },
  { externalId: 'osm:node:9002', osmType: 'node', osmId: 9002, name: 'San Telmo', tags: { place: 'neighbourhood', wikidata: 'Q1034165' }, center: { lat: -34.62, lng: -58.372 } },
  { externalId: 'osm:node:9003', osmType: 'node', osmId: 9003, name: 'Microcentro', tags: { place: 'quarter' }, center: { lat: -34.603, lng: -58.376 } },
  { externalId: 'osm:node:9004', osmType: 'node', osmId: 9004, name: 'Microcentro', tags: { place: 'quarter' }, center: { lat: -34.604, lng: -58.377 } },
];

export const POIS: OsmRecord[] = [
  { externalId: 'osm:way:31364659', osmType: 'way', osmId: 31364659, name: 'Plaza Dorrego', tags: { leisure: 'park', historic: 'yes', wikidata: 'Q2721567' }, center: { lat: -34.6205, lng: -58.3716 } },
  { externalId: 'osm:way:99', osmType: 'way', osmId: 99, name: 'Mercado de San Telmo', tags: { amenity: 'marketplace' }, center: { lat: -34.6211, lng: -58.3726 } },
  { externalId: 'osm:node:10910591117', osmType: 'node', osmId: 10910591117, name: 'Parque Lezama', tags: { highway: 'bus_stop', public_transport: 'platform' }, center: { lat: -34.6259, lng: -58.3678 } },
  { externalId: 'osm:way:17441757', osmType: 'way', osmId: 17441757, name: 'Parque Lezama', tags: { leisure: 'park' }, center: { lat: -34.6271, lng: -58.3693 } },
  { externalId: 'osm:node:55', osmType: 'node', osmId: 55, name: 'Museo Histórico Nacional', tags: { tourism: 'museum', wikidata: 'Q5897998' }, center: { lat: -34.6268, lng: -58.3700 } },
  { externalId: 'osm:node:57', osmType: 'node', osmId: 57, name: 'Monumento a Dorrego', tags: { historic: 'memorial' }, center: { lat: -34.6207, lng: -58.3717 } },
  { externalId: 'osm:node:56', osmType: 'node', osmId: 56, name: 'Far Away Museum', tags: { tourism: 'museum' }, center: { lat: -34.70, lng: -58.50 } },
];

export function fakeOsm(overrides: Partial<OsmStructuredAdapter> = {}): OsmStructuredAdapter {
  return {
    adminAreas: async () => ADMIN,
    namedPlaces: async () => NAMED,
    pois: async () => POIS,
    walkableStreetNames: async () => ['Defensa', 'Humberto I'],
    boundary: async (t, id) => {
      const b = BOUNDARIES[`${t}/${id}`];
      if (!b) throw new StructuredProviderFailure(`no boundary ${t}/${id}`);
      return b;
    },
    elementTags: async (t, id) => [...ADMIN, ...NAMED, ...POIS].find((r) => r.osmType === t && r.osmId === id)?.tags ?? {},
    ...overrides,
  };
}

export const WD: Record<string, WikidataFacts> = {
  Q1034165: { qid: 'Q1034165', sitelinks: 31, names: ['San Telmo', 'Barrio de San Telmo'], heritage: [], museumClass: false },
  Q1050240: { qid: 'Q1050240', sitelinks: 35, names: ['Recoleta'], heritage: [], museumClass: false },
  Q7128049: { qid: 'Q7128049', sitelinks: 6, names: ['Palermo Soho', 'Palermo Viejo'], heritage: [], museumClass: false },
  Q2721567: { qid: 'Q2721567', sitelinks: 9, names: ['Plaza Dorrego'], heritage: [{ qid: 'Q19903688', label: 'Monumento Histórico Nacional' }], museumClass: false },
  Q5897998: { qid: 'Q5897998', sitelinks: 7, names: ['Museo Histórico Nacional'], heritage: [], museumClass: true },
};

export function fakeWikidata(fail = false): WikidataFactsAdapter & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async facts(qids) {
      calls.push(qids);
      if (fail) throw new StructuredProviderFailure('wikidata down');
      return new Map(qids.filter((q) => WD[q]).map((q) => [q, WD[q]]));
    },
  };
}

export const DEFENSA_ROUTE: GeoEntityRef = {
  id: 'geo:osm-route:osm:way:1', kind: 'ROUTE', name: 'Defensa',
  identities: [{ provider: 'openstreetmap', externalId: 'osm:way:1' }, { provider: 'openstreetmap', externalId: 'osm:way:2' }],
  geometry: { type: 'MultiLineString', coordinates: [[[-58.3720, -34.6080], [-58.3718, -34.6120], [-58.3716, -34.6160]], [[-58.3716, -34.6160], [-58.3716, -34.6205], [-58.3714, -34.6250], [-58.3712, -34.6290]]] },
  centroid: { lng: -58.3716, lat: -34.6185 },
};

export function fakeRoutes(): OsmGeoResolver {
  return {
    resolveRoute: async (name: string): Promise<IdentityResult> =>
      name === 'Defensa' ? { status: 'RESOLVED', entity: DEFENSA_ROUTE, rule: 'STRUCTURED_ROUTE' } : { status: 'AMBIGUOUS', detail: 'two clusters' },
  } as unknown as OsmGeoResolver;
}

export const FIXTURE_DESTINATION: DestinationResolution = { scale: 'area', boundary: CABA, attemptedQueries: ['fixture'] };

export const REQUEST_A2: InterpretedRequest = {
  destinationLabel: 'Buenos Aires', days: 4, thematicFacets: ['theme:food', 'theme:history'], experienceFormatFacets: ['intent:walk'],
  mobility: { allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT], maxWalkingDistancePerDayMeters: 8000, maxContinuousWalkingDistanceMeters: 3000, travelPace: TravelPace.MODERATE, accessibilityNeeds: [] },
};
