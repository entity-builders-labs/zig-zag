import { calculateDistance } from '@shared/utils/distance.utils';
import {
  BoundingBox,
  Coordinate,
  SpatialFootprint,
} from '../interfaces/daily-planning.interface';

type ComponentLike = {
  required?: boolean;
  role?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: any;
  geoEntity?: {
    latitude?: number | null;
    longitude?: number | null;
    geometry?: any;
  };
};

export function buildPointFootprint(
  lat: number,
  lng: number,
): SpatialFootprint {
  return { type: 'POINT', centroid: { lat, lng } };
}

function validCoordinate(lat: unknown, lng: unknown): lat is number {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function geometryCoordinates(geometry: any): Coordinate[] {
  if (!geometry || typeof geometry !== 'object') return [];
  const pair = ([lng, lat]: [number, number]): Coordinate => ({ lat, lng });
  if (geometry.type === 'Point') return [pair(geometry.coordinates)];
  if (geometry.type === 'LineString') return geometry.coordinates.map(pair);
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates?.[0] ?? []).map(pair);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates ?? []).flatMap((polygon: any) =>
      (polygon?.[0] ?? []).map(pair),
    );
  }
  return [];
}

function boundsOf(points: Coordinate[]): BoundingBox | undefined {
  if (points.length === 0) return undefined;
  return {
    north: Math.max(...points.map((point) => point.lat)),
    south: Math.min(...points.map((point) => point.lat)),
    east: Math.max(...points.map((point) => point.lng)),
    west: Math.min(...points.map((point) => point.lng)),
  };
}

function centroidOf(points: Coordinate[]): Coordinate | undefined {
  if (points.length === 0) return undefined;
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

/**
 * Planner-native footprint for a persisted Experience.
 *
 * A multi-component Experience must not collapse to its first component. A
 * canonical route keeps its line geometry, an area keeps its bounds, and a
 * component-defined Experience uses all resolved component points to create a
 * bounded footprint. The persisted Experience centroid is only a fallback when
 * component geometry is unavailable.
 */
export function buildExperienceFootprint(input: {
  latitude?: number | null;
  longitude?: number | null;
  components?: ComponentLike[];
}): SpatialFootprint {
  const components = (input.components ?? []).filter(
    (component) => component.required !== false,
  );

  const canonicalRoute = components.find(
    (component) =>
      component.role === 'route' &&
      (component.geoEntity?.geometry ?? component.geometry)?.type ===
        'LineString',
  );
  if (canonicalRoute) {
    const points = geometryCoordinates(
      canonicalRoute.geoEntity?.geometry ?? canonicalRoute.geometry,
    );
    const centroid = centroidOf(points);
    if (centroid) {
      return {
        type: 'LINE',
        centroid,
        bounds: boundsOf(points),
        geometry: points,
      };
    }
  }

  const canonicalArea = components.find((component) => {
    const geometry = component.geoEntity?.geometry ?? component.geometry;
    return (
      component.role === 'area' &&
      (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon')
    );
  });
  if (canonicalArea) {
    const points = geometryCoordinates(
      canonicalArea.geoEntity?.geometry ?? canonicalArea.geometry,
    );
    const centroid = centroidOf(points);
    if (centroid) {
      return { type: 'AREA', centroid, bounds: boundsOf(points) };
    }
  }

  const componentPoints = components.flatMap((component) => {
    const entity = component.geoEntity ?? component;
    if (validCoordinate(entity.latitude, entity.longitude)) {
      return [{ lat: entity.latitude, lng: entity.longitude as number }];
    }
    return geometryCoordinates(entity.geometry);
  });
  const componentCentroid = centroidOf(componentPoints);
  if (componentCentroid) {
    return componentPoints.length === 1
      ? { type: 'POINT', centroid: componentCentroid }
      : {
          type: 'AREA',
          centroid: componentCentroid,
          bounds: boundsOf(componentPoints),
        };
  }

  if (validCoordinate(input.latitude, input.longitude)) {
    return buildPointFootprint(input.latitude, input.longitude as number);
  }

  return buildPointFootprint(Number.NaN, Number.NaN);
}

export function footprintDistanceMeters(
  a: SpatialFootprint,
  b: SpatialFootprint,
): number {
  const km = calculateDistance(
    { latitude: a.centroid.lat, longitude: a.centroid.lng },
    { latitude: b.centroid.lat, longitude: b.centroid.lng },
  );
  return km * 1000;
}
