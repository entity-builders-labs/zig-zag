import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { Coordinates } from '@shared/utils/distance.utils';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import {
  centroidOfGeometry,
  distanceMeters,
} from './geographic-coherence.util';
import { DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS } from '../interfaces/geographic-validation.interface';

/**
 * THE single owner of "is this candidate/GeoEntity compatible with the
 * resolved DESTINATION?" -- used by component identity resolution (AREA,
 * ROUTE, catalog reuse) and by composite geographic validation's
 * destination-boundary check. It answers only destination scope, never
 * neighborhood-anchor membership: a Plaza de Mayo component of a San Telmo
 * walk is compatible because it lies in Buenos Aires, whether or not it lies
 * in San Telmo. Route/anchor coherence belongs to composite geographic
 * validation.
 *
 * Authority: the destination's own OSM administrative unit. It is evaluated
 * as containment in that unit's already-hydrated boundary geometry, which
 * the 2026-09-24 characterization showed gives the SAME verdict as the
 * admin-hierarchy (`is_in`) lookup on 60/60 real probes (Defensa, San
 * Lorenzo, Caminito, Galería Güemes x2, San Martín, La Plata, San Telmo) at
 * zero network cost -- see
 * spikes/stage3-destination-policy-characterization-2026-09-24/.
 *
 * For destination-local experiences (walks and single venues), compatibility
 * is strictly polygon-based (never distance-based).
 * For regional routes (options.routeScale === true), PLACE components may
 * legitimately extend outside the destination boundary within route-scale radius
 * from the destination centroid.
 *
 * Unknown stays UNKNOWN: a point-scale destination has no admin unit,
 * and a candidate without a location cannot be placed.
 */

export type DestinationCompatibilityVerdict =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNKNOWN';

export type DestinationCompatibilityReason =
  | 'WITHIN_DESTINATION_BOUNDARY'
  | 'SAME_AS_DESTINATION'
  | 'OUTSIDE_DESTINATION_BOUNDARY'
  | 'WITHIN_ROUTE_DESTINATION_RADIUS'
  | 'OUTSIDE_ROUTE_DESTINATION_RADIUS'
  | 'CANDIDATE_COARSER_THAN_DESTINATION'
  | 'DESTINATION_BOUNDARY_UNKNOWN'
  | 'CANDIDATE_LOCATION_UNKNOWN';

export interface DestinationCompatibility {
  verdict: DestinationCompatibilityVerdict;
  reason: DestinationCompatibilityReason;
}

export interface DestinationCompatibilityOptions {
  routeScale?: boolean;
}

export interface DestinationCompatibilityCandidate {
  /**
   * Real locations of the candidate: its representative point, or for a
   * multi-segment ROUTE one real vertex per segment. Compatible when ANY
   * lies inside (a real street may continue past the city limit).
   */
  probePoints: Coordinates[];
  /** The candidate's own OSM object, when it is itself an admin unit. */
  self?: {
    osmType: 'node' | 'way' | 'relation';
    osmId: number;
    adminLevel?: number;
  };
}

function adminLevelOf(tags: Record<string, string> | undefined) {
  const level = Number(tags?.admin_level);
  return Number.isFinite(level) ? level : undefined;
}

export function evaluateDestinationCompatibility(
  candidate: DestinationCompatibilityCandidate,
  destination: GeographicScope | undefined,
  options?: DestinationCompatibilityOptions,
): DestinationCompatibility {
  const boundary =
    destination?.kind === 'AREA_BOUNDARY' ? destination.boundary : undefined;
  const geometry = boundary?.geometry;
  if (
    !boundary ||
    !geometry ||
    (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
  ) {
    return { verdict: 'UNKNOWN', reason: 'DESTINATION_BOUNDARY_UNKNOWN' };
  }

  if (
    candidate.self &&
    candidate.self.osmType === boundary.osmType &&
    candidate.self.osmId === boundary.osmId
  ) {
    return { verdict: 'COMPATIBLE', reason: 'SAME_AS_DESTINATION' };
  }

  const probes = candidate.probePoints.filter(
    (p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude),
  );
  if (probes.length === 0) {
    return { verdict: 'UNKNOWN', reason: 'CANDIDATE_LOCATION_UNKNOWN' };
  }

  const inside = probes.some((p) =>
    geometryContainsPoint(geometry, p.longitude, p.latitude),
  );
  if (!inside) {
    if (options?.routeScale && !candidate.self) {
      const destinationCenter = centroidOfGeometry(geometry);
      const withinRadius = probes.some(
        (p) =>
          distanceMeters(destinationCenter, {
            latitude: p.latitude,
            longitude: p.longitude,
          }) <= DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS.route.maxRadiusMeters,
      );
      if (withinRadius) {
        return {
          verdict: 'COMPATIBLE',
          reason: 'WITHIN_ROUTE_DESTINATION_RADIUS',
        };
      }
      return {
        verdict: 'INCOMPATIBLE',
        reason: 'OUTSIDE_ROUTE_DESTINATION_RADIUS',
      };
    }
    return { verdict: 'INCOMPATIBLE', reason: 'OUTSIDE_DESTINATION_BOUNDARY' };
  }

  const destinationLevel = adminLevelOf(boundary.tags);
  if (
    candidate.self?.adminLevel !== undefined &&
    destinationLevel !== undefined &&
    candidate.self.adminLevel < destinationLevel
  ) {
    return {
      verdict: 'INCOMPATIBLE',
      reason: 'CANDIDATE_COARSER_THAN_DESTINATION',
    };
  }

  return { verdict: 'COMPATIBLE', reason: 'WITHIN_DESTINATION_BOUNDARY' };
}
