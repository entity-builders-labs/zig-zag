import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { Coordinates } from '@shared/utils/distance.utils';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { AreaScopeComponentFact } from '../interfaces/area-scope-membership.interface';
import {
  ExperienceDestinationRelation,
  ScopeDestinationRelation,
} from '../interfaces/experience-geographic-scope.interface';
import {
  classifyComponentAreaRelation,
  classifyComponentPointRadiusRelation,
} from './area-scope-membership-policy';

/**
 * THE single owner of the trip-DESTINATION relation (spec
 * 2026-10-02 Part II §P2-2 question C, §P2-9). Destination geography is the
 * destination's own OSM administrative polygon (or, for a point destination,
 * its explicit point-radius scope). It is NEVER a circle around the
 * destination centroid and never borrows a distance owned by another policy
 * (composition coherence, identity acquisition): the former route-scale
 * destination radius is deleted.
 *
 * Three entry points, one geometry authority:
 *  - `evaluateDestinationCompatibility`: is THIS candidate/GeoEntity inside
 *    the destination polygon? Used where the destination IS the scope that
 *    judges a component (destination-local candidates, destination-scoped
 *    identity acquisition, user anchors). Strictly polygon-based.
 *  - `evaluateScopeDestinationRelation`: how a candidate-owned scope
 *    geometry relates to the destination — a fact the §P2-6 admissibility
 *    table consumes, not a gate in itself.
 *  - `evaluateExperienceDestinationRelation`: the per-Experience
 *    WITHIN / EXTENDS_BEYOND / OUTSIDE / UNKNOWN fact consumed by tour
 *    eligibility. Trip-relative, never persisted as catalog truth.
 *
 * Authority (compatibility): containment in the already-hydrated boundary
 * geometry, which the 2026-09-24 characterization showed gives the SAME
 * verdict as the admin-hierarchy (`is_in`) lookup on 60/60 real probes at
 * zero network cost -- see spikes/stage3-destination-policy-characterization-2026-09-24/.
 *
 * Unknown stays UNKNOWN: a point-scale destination has no admin unit, and a
 * candidate without a location cannot be placed.
 */

export type DestinationCompatibilityVerdict =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNKNOWN';

export type DestinationCompatibilityReason =
  | 'WITHIN_DESTINATION_BOUNDARY'
  | 'SAME_AS_DESTINATION'
  | 'OUTSIDE_DESTINATION_BOUNDARY'
  | 'CANDIDATE_COARSER_THAN_DESTINATION'
  | 'DESTINATION_BOUNDARY_UNKNOWN'
  | 'CANDIDATE_LOCATION_UNKNOWN';

export interface DestinationCompatibility {
  verdict: DestinationCompatibilityVerdict;
  reason: DestinationCompatibilityReason;
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

function destinationPolygon(
  destination: GeographicScope | undefined,
): GeoJsonGeometry | undefined {
  const geometry =
    destination?.kind === 'AREA_BOUNDARY'
      ? destination.boundary?.geometry
      : undefined;
  return geometry &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
    ? geometry
    : undefined;
}

export function evaluateDestinationCompatibility(
  candidate: DestinationCompatibilityCandidate,
  destination: GeographicScope | undefined,
): DestinationCompatibility {
  const boundary =
    destination?.kind === 'AREA_BOUNDARY' ? destination.boundary : undefined;
  const geometry = destinationPolygon(destination);
  if (!boundary || !geometry) {
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
    return { verdict: 'INCOMPATIBLE', reason: 'OUTSIDE_DESTINATION_BOUNDARY' };
  }

  if (isCoarserThanDestination(candidate.self?.adminLevel, destination)) {
    return {
      verdict: 'INCOMPATIBLE',
      reason: 'CANDIDATE_COARSER_THAN_DESTINATION',
    };
  }

  return { verdict: 'COMPATIBLE', reason: 'WITHIN_DESTINATION_BOUNDARY' };
}

/**
 * Whether an administrative unit is coarser (a lower OSM `admin_level`) than
 * the destination's own administrative unit — the same comparison
 * `CANDIDATE_COARSER_THAN_DESTINATION` already applied inside the
 * destination, exposed so a candidate-owned scope beyond the destination is
 * held to it too (coarse-AREA guard, §P2-8 open item). Unknown levels never
 * count as coarser: this guard only fires on positive admin evidence.
 */
export function isCoarserThanDestination(
  candidateAdminLevel: number | undefined,
  destination: GeographicScope | undefined,
): boolean {
  const destinationLevel =
    destination?.kind === 'AREA_BOUNDARY'
      ? adminLevelOf(destination.boundary?.tags)
      : undefined;
  return (
    candidateAdminLevel !== undefined &&
    destinationLevel !== undefined &&
    candidateAdminLevel < destinationLevel
  );
}

/**
 * Relation of one component's canonical geometry to the destination, via
 * the single area/point-radius relation authority.
 */
function componentDestinationRelation(
  component: AreaScopeComponentFact,
  destination: GeographicScope | undefined,
) {
  if (destination?.kind === 'POINT_RADIUS') {
    return classifyComponentPointRadiusRelation(destination, component);
  }
  return classifyComponentAreaRelation(
    destinationPolygon(destination),
    component,
  );
}

/**
 * How a candidate-owned scope geometry (AREA polygon or ROUTE line) relates
 * to the destination. A point-radius destination is related through its own
 * radius scope; an unknown destination stays UNKNOWN.
 */
export function evaluateScopeDestinationRelation(
  scopeGeometry: GeoJsonGeometry,
  scopeRole: 'area' | 'route',
  destination: GeographicScope | undefined,
): ScopeDestinationRelation {
  if (destination?.kind === 'POINT_RADIUS') {
    // A point-radius scope only relates points honestly; a line/polygon
    // stays UNDETERMINED there (classifyComponentPointRadiusRelation).
    const relation = classifyComponentPointRadiusRelation(destination, {
      role: scopeRole,
      geometry: scopeGeometry,
    }).relation;
    return relation === 'UNDETERMINED' ? 'UNKNOWN' : relation;
  }
  const relation = classifyComponentAreaRelation(
    destinationPolygon(destination),
    { role: scopeRole, geometry: scopeGeometry },
  ).relation;
  return relation === 'UNDETERMINED' ? 'UNKNOWN' : relation;
}

/**
 * The per-Experience destination relation fact (§P2-9). A component is
 * inside when its canonical geometry is INSIDE or INTERSECTS the
 * destination; positively OUTSIDE components make the Experience extend
 * beyond (or lie outside) it. An undetermined component — or an unknown
 * destination — keeps the relation UNKNOWN whenever it could change the
 * answer; EXTENDS_BEYOND needs one positively inside and one positively
 * outside component, so it survives undetermined siblings.
 */
export function evaluateExperienceDestinationRelation(
  components: AreaScopeComponentFact[],
  destination: GeographicScope | undefined,
): ExperienceDestinationRelation {
  const facts = components.map((component, index) => ({
    key: component.hintKey ?? String(index),
    relation: componentDestinationRelation(component, destination).relation,
  }));
  const outsideComponentKeys = facts
    .filter((fact) => fact.relation === 'OUTSIDE')
    .map((fact) => fact.key);
  const undeterminedComponentKeys = facts
    .filter((fact) => fact.relation === 'UNDETERMINED')
    .map((fact) => fact.key);
  const insideCount = facts.filter(
    (fact) => fact.relation === 'INSIDE' || fact.relation === 'INTERSECTS',
  ).length;

  const relation =
    facts.length === 0
      ? 'UNKNOWN'
      : outsideComponentKeys.length === 0
        ? undeterminedComponentKeys.length === 0
          ? 'WITHIN_DESTINATION'
          : 'UNKNOWN'
        : insideCount > 0
          ? 'EXTENDS_BEYOND_DESTINATION'
          : undeterminedComponentKeys.length === 0
            ? 'OUTSIDE_DESTINATION'
            : 'UNKNOWN';
  return { relation, outsideComponentKeys, undeterminedComponentKeys };
}
