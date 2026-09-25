import { GeoEntityKind } from '@prisma/client';

export type AreaScopeMembershipPolicy =
  | 'AREA_CONTAINED'
  | 'AREA_ANCHORED_ROUTE';

/**
 * Typed relation of ONE resolved physical component to an AREA scope
 * (Polygon/MultiPolygon), computed from its canonical geometry only.
 *
 * - INSIDE: the whole canonical object is covered by the area.
 * - INTERSECTS: part of a line/polygon is inside, or it crosses/touches the
 *   boundary. Never produced for a point.
 * - OUTSIDE: no part of the canonical object is inside or on the area.
 * - UNDETERMINED: the component has no canonical geometry this relation can
 *   honestly be computed from (e.g. a ROUTE/AREA without line/polygon
 *   geometry). Never read as INSIDE or OUTSIDE.
 *
 * NEAR is deliberately not classified yet: it needs a boundary-distance
 * threshold that must come from observed Stage 5 distributions, not be
 * invented here. OUTSIDE points carry the measured boundary distance as
 * observability only.
 */
export type ComponentAreaRelation =
  | 'INSIDE'
  | 'INTERSECTS'
  | 'OUTSIDE'
  | 'UNDETERMINED';

/** The canonical geometry a relation was computed from. */
export type ComponentGeometryBasis = 'POINT' | 'LINE' | 'POLYGON' | 'NONE';

export interface ComponentAreaRelationFact {
  hintKey?: string;
  role: string;
  basis: ComponentGeometryBasis;
  relation: ComponentAreaRelation;
  /** Measured for an OUTSIDE point only; observability, not a threshold. */
  distanceToBoundaryMeters?: number;
}

export interface AreaScopeMembershipDecision {
  passes: boolean;
  /** A LINE component (a real street/route geometry) enters the area. */
  routeIntersectsArea: boolean;
  /** A non-area, non-line component is INSIDE the area. */
  pointComponentInside: boolean;
  /** Per-component relations the decision was made from. */
  components: ComponentAreaRelationFact[];
}

export interface AreaScopeMembershipAudit {
  policy: AreaScopeMembershipPolicy;
  decision: AreaScopeMembershipDecision;
  routeGeometryPresent: boolean;
  evaluatedComponentCount: number;
}

/**
 * Structural facts of one resolved component. Every component the caller
 * passes is evaluated: there is no flag that hides a component from the
 * policy.
 */
export interface AreaScopeComponentFact {
  hintKey?: string;
  role: string;
  /** Canonical physical kind, when known. */
  kind?: GeoEntityKind;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
}
