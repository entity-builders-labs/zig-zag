import { ResolvedGeoEntity } from './experience-resolution.interface';
import { AreaScopeMembershipAudit } from './area-scope-membership.interface';

export type GeographicValidationStatus =
  | 'UNVERIFIED'
  | 'GROUNDED'
  | 'GEO_VERIFIED'
  | 'AUTHORITATIVELY_VERIFIED'
  | 'REJECTED';

export type GeographicVerificationStrategy =
  | 'canonical_entity'
  | 'canonical_area'
  | 'compact_anchors'
  | 'canonical_geometry'
  | 'component_defined'
  | 'venue_centric';

export type GeographicValidationRejectionReason =
  | 'no_resolved_entities'
  | 'insufficient_resolved_entities'
  | 'missing_coordinates'
  | 'geographic_incoherence'
  | 'destination_mismatch'
  | 'grounded_evidence_missing'
  // Not every source-backed component hint has a resolved canonical
  // identity: the composition is incomplete and is never validated as a
  // trimmed subset.
  | 'incomplete_source_composition'
  | 'ambiguous_component'
  // Task B5: a request-level (non-candidate-owned) validationScope was
  // violated -- a component lies outside the externally resolved
  // AREA polygon, or outside the externally resolved ROUTE's corridor.
  | 'external_scope_mismatch';

/**
 * Machine-readable reason for a geographic mismatch decision.
 * These correspond to actual branches in the validator and are stable
 * forensic identifiers — do not use prose as policy.
 */
export type GeographicDecisionReason =
  | 'OUTSIDE_DESTINATION_BOUNDARY'
  | 'OUTSIDE_CANONICAL_AREA_BOUNDARY'
  | 'OUTSIDE_POINT_RADIUS_SCOPE'
  | 'COUNTRY_CONFLICT'
  | 'REGION_CONFLICT'
  | 'LOCALITY_CONFLICT'
  | 'OUTSIDE_ROUTE_DESTINATION_RADIUS'
  | 'EXTERNAL_AREA_SCOPE_MISMATCH'
  | 'EXTERNAL_ROUTE_SCOPE_MISMATCH';

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export interface GeographicCoherenceMetrics {
  centroid: GeographicPoint;
  radiusMeters: number;
  maxPairwiseDistanceMeters: number;
}

export interface GeographicValidationDecisionEntity {
  geoEntityId?: string;
  hintKey?: string;
  relation: 'evaluated' | 'offending';
  /**
   * Machine-readable reason for the entity's role in the decision.
   * Present for 'offending' entities; may be present for 'evaluated' if useful.
   */
  decisionReason?: GeographicDecisionReason;
  /**
   * Shortest distance in meters from the resolved point to the destination boundary.
   * Only populated for OUTSIDE_DESTINATION_BOUNDARY rejections.
   * Absent when unknown or not applicable.
   */
  distanceToBoundaryMeters?: number;
}

export interface GeographicValidationResult {
  proposalName: string;
  kind: string;
  status: GeographicValidationStatus;
  accepted: boolean;
  strategy?: GeographicVerificationStrategy;
  canonicalEntity?: ResolvedGeoEntity;
  anchors: ResolvedGeoEntity[];
  coherence?: GeographicCoherenceMetrics;
  groundedEvidenceKeys: string[];
  rejectionReasons: GeographicValidationRejectionReason[];
  areaScopeMembership?: AreaScopeMembershipAudit;
  decisionEntities?: GeographicValidationDecisionEntity[];
  validatorVersion: number;
}

export interface GeographicValidationBatchResult {
  results: GeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
}

export interface GeographicValidationThresholds {
  neighborhoodWalk: {
    minAnchors: number;
    maxRadiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
  route: {
    minAnchors: number;
    maxRadiusMeters: number;
    maxPairwiseDistanceMeters: number;
    // Task B5: max distance (meters) a point-like component may
    // sit from a resolved canonical ROUTE's own LineString geometry to
    // still count as "on/along the route" -- a real corridor-membership
    // check, distinct from the regional destination-centroid/radius policy
    // above (`maxRadiusMeters`/`maxPairwiseDistanceMeters`).
    maxComponentDistanceFromRouteMeters: number;
  };
  experience: {
    minAnchors: number;
    maxRadiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
}

export const DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS: GeographicValidationThresholds =
  {
    neighborhoodWalk: {
      minAnchors: 3,
      maxRadiusMeters: 2_000,
      maxPairwiseDistanceMeters: 4_000,
    },
    route: {
      minAnchors: 3,
      maxRadiusMeters: 80_000,
      maxPairwiseDistanceMeters: 160_000,
      // A real stop genuinely "on" a walkable street-scale route sits
      // within a couple hundred meters of it -- wide enough for a street's
      // own width/nearby frontage, narrow enough that a stop from an
      // unrelated part of the city cannot pass as belonging to this route.
      maxComponentDistanceFromRouteMeters: 300,
    },
    experience: {
      minAnchors: 2,
      maxRadiusMeters: 30_000,
      maxPairwiseDistanceMeters: 60_000,
    },
  };

export const GEOGRAPHIC_VALIDATOR_VERSION = 1;
