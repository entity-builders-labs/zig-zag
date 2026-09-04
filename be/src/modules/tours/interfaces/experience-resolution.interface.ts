import { ExperienceCandidate } from './experience-discovery.interface';
import { DedupeEvidence } from '../utils/experience-dedupe.util';

export type ResolvedGeoEntityStatus = 'resolved' | 'unresolved';

export interface ResolvedGeoEntity {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  status: ResolvedGeoEntityStatus;
  reason?: string;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
}

export interface ResolvedExperienceCandidate {
  candidate: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: ResolvedGeoEntity[];
  rejectionReasons: string[];
  /**
   * Internal verification signal: referenced grounded evidence explicitly
   * associates this Experience with the requested destination/base. It lets
   * geographic validation verify an Experience's own coherent geography
   * without incorrectly requiring every associated Experience to lie inside
   * the destination polygon.
   */
  destinationAssociationVerified?: boolean;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeEvidence?: DedupeEvidence;
  dedupeCandidates?: string[];
}

export interface ExperienceResolutionRequest {
  candidates: ExperienceCandidate[];
  destinationName?: string;
  destinationBoundary: unknown;
  traceContext?: Record<string, unknown>;
  evidence?: Array<{
    key?: string;
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
}

export interface ExperienceGeographicValidationResult {
  proposalName: string;
  /** Keep this aligned with the validator boundary. Candidate extraction owns
   * the finite proposal vocabulary; geographic validation reports what it
   * actually evaluated instead of narrowing the runtime result a second time. */
  kind: string;
  status:
    | 'UNVERIFIED'
    | 'GROUNDED'
    | 'GEO_VERIFIED'
    | 'AUTHORITATIVELY_VERIFIED'
    | 'REJECTED';
  accepted: boolean;
  strategy?:
    | 'canonical_entity'
    | 'canonical_area'
    | 'compact_anchors'
    | 'canonical_geometry'
    | 'component_defined'
    | 'venue_centric';
  canonicalEntity?: ResolvedGeoEntity;
  anchors: ResolvedGeoEntity[];
  coherence?: {
    centroid: { latitude: number; longitude: number };
    radiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  validatorVersion: number;
}

export interface ExperienceGeographicValidationBatchResult {
  results: ExperienceGeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
  resolved?: ResolvedExperienceCandidate[];
}

export interface ExperienceMaterializationResponse {
  resolved: ResolvedExperienceCandidate[];
}

export interface ExperienceEntityResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
}

/**
 * Shared resolution shape used by intermediate trace/test fixtures. The final
 * V2 resolver result is refined below so geographic validation cannot be
 * omitted from the canonical pipeline.
 */
export interface ExperienceResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
  entityResolution?: ExperienceEntityResolutionResponse;
  geographicValidation?: ExperienceGeographicValidationBatchResult;
  materialization?: ExperienceMaterializationResponse;
}

export interface FinalExperienceResolutionResponse
  extends ExperienceResolutionResponse {
  geographicValidation: ExperienceGeographicValidationBatchResult;
}

export interface ExperienceProposalResolver {
  resolve(
    request: ExperienceResolutionRequest,
  ): Promise<FinalExperienceResolutionResponse>;
}

export const EXPERIENCE_PROPOSAL_RESOLVER = 'EXPERIENCE_PROPOSAL_RESOLVER';