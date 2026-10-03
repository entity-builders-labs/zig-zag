import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';

export const REAL_WORLD_RECONCILIATION_RADIUS_METERS = 150;

export function normalizeRealWorldName(value: string): string {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function realWorldNamesMatch(left: string, right: string): boolean {
  const n = normalizeRealWorldName(left);
  const h = normalizeRealWorldName(right);
  if (!n || !h) return false;
  return n === h || n.includes(h) || h.includes(n);
}

export function distanceMeters(left: Coordinates, right: Coordinates): number {
  return calculateDistance(left, right) * 1000;
}
