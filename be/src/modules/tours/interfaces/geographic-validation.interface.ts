import { ActivityKind } from '@prisma/client';
import { ResolvedEntity } from './proposal-resolution.interface';

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
  | 'unresolved_required_component'
  | 'ambiguous_component';

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export interface GeographicCoherenceMetrics {
  centroid: GeographicPoint;
  radiusMeters: number;
  maxPairwiseDistanceMeters: number;
}

export interface GeographicValidationResult {
  proposalName: string;
  kind: ActivityKind;
  status: GeographicValidationStatus;
  accepted: boolean;
  strategy?: GeographicVerificationStrategy;
  canonicalEntity?: ResolvedEntity;
  anchors: ResolvedEntity[];
  coherence?: GeographicCoherenceMetrics;
  groundedEvidenceKeys: string[];
  rejectionReasons: GeographicValidationRejectionReason[];
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
    },
    experience: {
      minAnchors: 2,
      maxRadiusMeters: 30_000,
      maxPairwiseDistanceMeters: 60_000,
    },
  };

export const GEOGRAPHIC_VALIDATOR_VERSION = 1;
