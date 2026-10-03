import { ResolvedGeoEntity } from './experience-resolution.interface';
import { AreaScopeMembershipAudit } from './area-scope-membership.interface';
import { RouteScopeMembershipAudit } from './route-scope-membership.interface';
import {
  ExperienceDestinationRelation,
  ExperienceGeographicScopeProjection,
} from './experience-geographic-scope.interface';

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
  // §P2-18: verified components + one supporting source record, no
  // enclosing canonical geometry.
  | 'source_defined_components'
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
  | 'external_scope_mismatch'
  // Spec Part II §P2-7 (PD2 as amended by §P2-18): no Experience scope
  // could be established (a non-admissible candidate scope, or no usable
  // destination geography). A missing canonical AREA alone is never this
  // reason. Fail closed; never a manufactured region or radius.
  | 'geographic_scope_unknown'
  // A component lies outside a STRICT scope the Experience itself must
  // satisfy (a user-named regional anchor acting as the Experience scope).
  | 'outside_experience_scope'
  // §P2-18: a membership that no canonical geometry corroborates rests on
  // the source alone, and no single source record supports every member
  // (an unsupported union of separate sources/variants).
  | 'source_composition_unsupported';

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
  // §P2-18: a member positively outside the source-named AREA whose
  // verified admin region contradicts that AREA's own region evidence —
  // a contradiction of the source's claim, not a polygon verdict.
  | 'REGION_CONFLICT'
  | 'LOCALITY_CONFLICT'
  | 'GEOGRAPHIC_SCOPE_UNKNOWN'
  // §P2-18: no single source record supports every member of a composition
  // whose membership no canonical geometry corroborates.
  | 'COMPOSITION_NOT_SUPPORTED_BY_ONE_SOURCE'
  | 'EXTERNAL_AREA_SCOPE_MISMATCH'
  | 'EXTERNAL_ROUTE_SCOPE_MISMATCH'
  | 'NO_MATERIAL_ANCHOR_RELATION';

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
  /**
   * Shortest distance in meters from the resolved point to the route anchor line.
   * Strict invariant: distance is evidence/diagnostic for observability, never
   * a semantic cutoff threshold.
   */
  distanceFromRouteMeters?: number;
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
  routeScopeMembership?: RouteScopeMembershipAudit;
  decisionEntities?: GeographicValidationDecisionEntity[];
  /** The Experience scope the decision was made against (§P2-7). */
  experienceScope?: ExperienceGeographicScopeProjection;
  /** Trip-relative fact (§P2-9); never a validity gate for a verified scope. */
  destinationRelation?: ExperienceDestinationRelation;
  validatorVersion: number;
}

export interface GeographicValidationBatchResult {
  results: GeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
}

/**
 * Bumped to 2 by the Part II geographic-scope cutover: decisions are made
 * against a derived Experience scope (no destination-centroid circle, no
 * coherence radius). Bumped to 3 by §P2-18: candidate-owned scopes are
 * DESCRIPTIVE source context, and a ROUTE_LIKE composition without an
 * enclosing canonical geometry is judged on its source-defined components.
 */
export const GEOGRAPHIC_VALIDATOR_VERSION = 3;
