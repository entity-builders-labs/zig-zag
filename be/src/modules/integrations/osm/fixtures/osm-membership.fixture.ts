import { OsmCandidate } from '../services/osm-places.service';

// Deterministic, hand-authored polygon fixtures for exact point-to-area
// membership. Coordinates are deliberately small, axis-aligned boxes: they
// prove inside/outside/ambiguous/overlap semantics without a live Overpass
// round-trip. They are NOT real Buenos Aires/San Telmo/La Boca geometry —
// only the names and rough coordinates are Argentina-real (the local OSM
// instance only carries Argentine data).

export interface RectSpec {
  id: string;
  name: string;
  adminLevel: string;
  west: number;
  east: number;
  south: number;
  north: number;
}

export function rectBoundary(spec: RectSpec): OsmCandidate {
  return {
    id: spec.id,
    name: spec.name,
    osmType: 'relation',
    osmId: Number.parseInt(spec.id.split(':').pop() ?? '0', 10) || 0,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [spec.west, spec.south],
          [spec.east, spec.south],
          [spec.east, spec.north],
          [spec.west, spec.north],
          [spec.west, spec.south],
        ],
      ],
    },
    tags: {
      name: spec.name,
      admin_level: spec.adminLevel,
      boundary: 'administrative',
    },
  };
}

// A city-level container (admin_level=8) large enough to hold all the
// neighborhoods below, with clear geographic separation between them.
export const BUENOS_AIRES_BOUNDARY = rectBoundary({
  id: 'osm:relation:1001',
  name: 'Buenos Aires',
  adminLevel: '8',
  west: -58.55,
  east: -58.3,
  south: -34.7,
  north: -34.5,
});

// Real Buenos Aires barrios, all inside BUENOS_AIRES_BOUNDARY.
export const SAN_TELMO_BOUNDARY = rectBoundary({
  id: 'osm:relation:2001',
  name: 'San Telmo',
  adminLevel: '9',
  west: -58.39,
  east: -58.36,
  south: -34.63,
  north: -34.61,
});

export const LA_BOCA_BOUNDARY = rectBoundary({
  id: 'osm:relation:2002',
  name: 'La Boca',
  adminLevel: '9',
  west: -58.37,
  east: -58.35,
  south: -34.65,
  north: -34.63,
});

export const RECOLETA_BOUNDARY = rectBoundary({
  id: 'osm:relation:2003',
  name: 'Recoleta',
  adminLevel: '9',
  west: -58.4,
  east: -58.38,
  south: -34.6,
  north: -34.58,
});

// OSM spells the barrio "Monserrat" (one 't'); grounded Discovery may write
// "Montserrat". This fixture proves the alias resolves inside the destination.
export const MONSERRAT_BOUNDARY = rectBoundary({
  id: 'osm:relation:2004',
  name: 'Monserrat',
  adminLevel: '9',
  west: -58.39,
  east: -58.37,
  south: -34.62,
  north: -34.6,
});

// A same-named area in a different Argentine city — proves a cross-city
// homonym can never be accepted by name alone.
export const OTHER_CITY_SAN_TELMO_BOUNDARY = rectBoundary({
  id: 'osm:relation:9999',
  name: 'San Telmo',
  adminLevel: '9',
  west: -64.2,
  east: -64.1,
  south: -31.45,
  north: -31.35,
});

// Representative points.
export const POINT_IN_SAN_TELMO = { latitude: -34.62, longitude: -58.37 };
export const POINT_IN_LA_BOCA = { latitude: -34.64, longitude: -58.36 };
export const POINT_IN_RECOLETA = { latitude: -34.59, longitude: -58.39 };
export const POINT_OUTSIDE_NEIGHBORHOODS = {
  latitude: -34.55,
  longitude: -58.36,
};
export const POINT_IN_OTHER_CITY = { latitude: -31.4, longitude: -64.15 };
