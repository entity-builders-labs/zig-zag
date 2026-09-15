export type AreaScopeMembershipPolicy =
  | 'AREA_CONTAINED'
  | 'AREA_ANCHORED_ROUTE';

export interface AreaScopeMembershipDecision {
  passes: boolean;
  routeIntersectsArea: boolean;
  requiredPointInside: boolean;
}

export interface AreaScopeMembershipAudit {
  policy: AreaScopeMembershipPolicy;
  decision: AreaScopeMembershipDecision;
  routeGeometryPresent: boolean;
  requiredPointCount: number;
}

export interface AreaScopeComponentFact {
  required: boolean;
  role: string;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
}
