import axios from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('RouteOptimizer');

// Google's Directions API supports up to 25 waypoints per request.
const MAX_WAYPOINTS = 25;

/**
 * Reorders activities to minimize total real-street walking distance,
 * starting and ending near the tour's destination point — using Google's
 * own route-optimization (Directions API with waypoints=optimize:true)
 * instead of whatever order the AI happened to list them in, which has no
 * actual geographic reasoning behind it.
 */
export async function optimizeActivityOrder<
  T extends { latitude: number; longitude: number },
>(
  origin: { latitude: number; longitude: number },
  points: T[],
  apiKey: string | undefined,
): Promise<T[]> {
  if (points.length <= 1 || !apiKey) return points;

  const toOptimize = points.slice(0, MAX_WAYPOINTS);
  const overflow = points.slice(MAX_WAYPOINTS);

  const originStr = `${origin.latitude},${origin.longitude}`;
  const waypointsStr = toOptimize
    .map((p) => `${p.latitude},${p.longitude}`)
    .join('|');

  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/directions/json',
      {
        params: {
          origin: originStr,
          destination: originStr,
          waypoints: `optimize:true|${waypointsStr}`,
          mode: 'walking',
          key: apiKey,
        },
        timeout: 8000,
      },
    );

    const order: number[] | undefined = data?.routes?.[0]?.waypoint_order;
    if (data?.status !== 'OK' || !Array.isArray(order)) {
      logger.warn(
        `Route optimization returned no usable order (status: ${data?.status}), keeping original order.`,
      );
      return points;
    }

    const optimized = order.map((i) => toOptimize[i]).filter(Boolean);
    return [...optimized, ...overflow];
  } catch (error) {
    logger.warn(
      `Route optimization request failed, keeping original order: ${error.message}`,
    );
    return points;
  }
}
