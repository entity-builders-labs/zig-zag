import {
  calculateDistance,
  Coordinates,
} from '../../../shared/utils/distance.utils';

/**
 * Reorders activities into a short walking route using a free,
 * dependency-free heuristic — nearest-neighbor construction followed by
 * 2-opt local search — over straight-line (haversine) distance.
 *
 * The AI has no real geographic reasoning, so without this, stops end up in
 * whatever order it happened to list them, zigzagging back and forth across
 * the search area. This doesn't know about streets, one-way restrictions, or
 * rivers — it's an approximation, not real routing — but it reliably fixes
 * that failure mode, needs no API key, has no rate limit, and costs nothing.
 * (Previously called Google's Directions API with waypoints=optimize:true;
 * replaced to remove the paid/rate-limited dependency for a ~15-stop tour.)
 */
export function optimizeActivityOrder<
  T extends { latitude: number; longitude: number },
>(origin: Coordinates, points: T[]): T[] {
  if (points.length <= 1) return points;

  const nearestNeighborOrder = buildNearestNeighborOrder(origin, points);
  const order = improveWithTwoOpt(origin, points, nearestNeighborOrder);

  return order.map((i) => points[i]);
}

function buildNearestNeighborOrder(
  origin: Coordinates,
  points: Coordinates[],
): number[] {
  const remaining = new Set(points.map((_, i) => i));
  const order: number[] = [];
  let current: Coordinates = origin;

  while (remaining.size > 0) {
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    for (const i of remaining) {
      const distance = calculateDistance(current, points[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    order.push(nearestIndex);
    remaining.delete(nearestIndex);
    current = points[nearestIndex];
  }

  return order;
}

/** Total length of origin -> points[order[0]] -> ... -> points[order[last]] (an open path, no return leg to origin). */
function routeLength(
  origin: Coordinates,
  points: Coordinates[],
  order: number[],
): number {
  let total = 0;
  let prev = origin;
  for (const i of order) {
    total += calculateDistance(prev, points[i]);
    prev = points[i];
  }
  return total;
}

/** Repeatedly reverses segments when doing so shortens the route, until no improving swap remains. */
function improveWithTwoOpt(
  origin: Coordinates,
  points: Coordinates[],
  initialOrder: number[],
): number[] {
  let order = initialOrder;
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (
          routeLength(origin, points, candidate) <
          routeLength(origin, points, order)
        ) {
          order = candidate;
          improved = true;
        }
      }
    }
  }

  return order;
}
