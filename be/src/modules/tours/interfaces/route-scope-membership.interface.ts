import { GeoEntityKind } from '@prisma/client';
import { ComponentGeometryBasis } from './area-scope-membership.interface';

/**
 * Typed relationship of one resolved physical component to a mandatory ROUTE anchor.
 *
 * - ANCHOR_COMPONENT: Matches the route anchor entity directly (by ID,
 *   canonical name, or matching route geometry).
 * - ON_ROUTE: A component physically located on or directly along the route line
 *   (or intersecting it).
 * - SAME_LOCAL_SCOPE: A component that shares local geographic/neighborhood context
 *   with the route anchor (e.g. within an explicit enclosing area polygon such as La Boca,
 *   or matching administrative locality).
 * - DESTINATION_COMPATIBLE_EXTENSION: A component within the destination boundary
 *   belonging to the source-backed composition anchored on the route.
 * - OUTSIDE_DESTINATION: A component that falls outside the destination boundary
 *   or fails destination compatibility.
 * - NO_MATERIAL_ANCHOR_RELATION: A component with no valid coordinate/geometry or
 *   no material relationship to the anchor.
 */
export type RouteComponentRelation =
  | 'ANCHOR_COMPONENT'
  | 'ON_ROUTE'
  | 'SAME_LOCAL_SCOPE'
  | 'DESTINATION_COMPATIBLE_EXTENSION'
  | 'OUTSIDE_DESTINATION'
  | 'NO_MATERIAL_ANCHOR_RELATION';

export interface RouteScopeComponentFact {
  hintKey?: string;
  hintName?: string;
  canonicalName?: string | null;
  role: string;
  kind?: GeoEntityKind;
  geoEntityId?: string;
  externalId?: string;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
}

export interface ComponentRouteRelationFact {
  hintKey?: string;
  role: string;
  basis: ComponentGeometryBasis;
  relation: RouteComponentRelation;
  /**
   * Diagnostic distance to route polyline in meters.
   * STRICT INVARIANT: Distance is evidence / diagnostic for observability
   * (e.g. Bitácora / trace), NEVER an arbitrary semantic cutoff for validity.
   */
  distanceFromRouteMeters?: number;
}

export interface RouteScopeMembershipDecision {
  passes: boolean;
  /** At least one component materially satisfies the mandatory route anchor. */
  hasAnchorSatisfaction: boolean;
  /** Whether any component violates destination boundary compatibility. */
  hasDestinationMismatch: boolean;
  /** Rejection reason if passes is false. */
  rejectionReason?:
    | 'NO_MATERIAL_ANCHOR_RELATION'
    | 'OUTSIDE_DESTINATION_BOUNDARY'
    | 'EXTERNAL_ROUTE_SCOPE_MISMATCH';
  /** Per-component relations the decision was made from. */
  components: ComponentRouteRelationFact[];
}

export interface RouteScopeMembershipAudit {
  decision: RouteScopeMembershipDecision;
  routeGeometryPresent: boolean;
  evaluatedComponentCount: number;
}
