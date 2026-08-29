import { calculateDistance } from '@shared/utils/distance.utils';
import { SpatialFootprint } from '../interfaces/daily-planning.interface';

export function buildPointFootprint(
  lat: number,
  lng: number,
): SpatialFootprint {
  return { type: 'POINT', centroid: { lat, lng } };
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
