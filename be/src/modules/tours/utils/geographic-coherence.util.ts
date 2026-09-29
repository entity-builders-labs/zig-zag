import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  GeographicCoherenceMetrics,
  GeographicPoint,
} from '../interfaces/geographic-validation.interface';

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(
  left: GeographicPoint,
  right: GeographicPoint,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude1 = toRadians(left.latitude);
  const latitude2 = toRadians(right.latitude);
  const deltaLatitude = toRadians(right.latitude - left.latitude);
  const deltaLongitude = toRadians(right.longitude - left.longitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function centroid(points: GeographicPoint[]): GeographicPoint {
  if (points.length === 0) {
    throw new Error('Cannot calculate a centroid without points');
  }
  return {
    latitude:
      points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude:
      points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

export function centroidOfGeometry(geometry: GeoJsonGeometry): GeographicPoint {
  if (geometry.type === 'Point') {
    return {
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  }
  const ring: [number, number][] =
    geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates.flat()
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];
  return {
    latitude: ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
    longitude: ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length,
  };
}

export function coherenceMetrics(
  points: GeographicPoint[],
): GeographicCoherenceMetrics {
  const center = centroid(points);
  const radiusMeters = Math.max(
    0,
    ...points.map((point) => distanceMeters(center, point)),
  );

  let maxPairwiseDistanceMeters = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      maxPairwiseDistanceMeters = Math.max(
        maxPairwiseDistanceMeters,
        distanceMeters(points[i], points[j]),
      );
    }
  }

  return { centroid: center, radiusMeters, maxPairwiseDistanceMeters };
}
