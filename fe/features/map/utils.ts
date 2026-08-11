import { Region } from './types';

// Computes a region that fits every given coordinate, with some padding so
// pins near the edge aren't clipped. Falls back to a fixed-zoom region
// around a single point when there's nothing (or only one point) to fit.
export function getRegionForCoordinates(
  coordinates: { latitude: number; longitude: number }[],
  fallback?: { latitude: number; longitude: number }
): Region | undefined {
  if (coordinates.length === 0) {
    return fallback ? { ...fallback, latitudeDelta: 0.02, longitudeDelta: 0.02 } : undefined;
  }

  const lats = coordinates.map((c) => c.latitude);
  const lngs = coordinates.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const PADDING_FACTOR = 1.4;
  const MIN_DELTA = 0.01;

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PADDING_FACTOR, MIN_DELTA),
  };
}
