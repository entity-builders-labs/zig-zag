import { ExperienceCandidate } from './experience-discovery.interface';

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
  proposal: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: ResolvedGeoEntity[];
  rejectionReasons: string[];
  experienceId?: string;
}

export interface ExperienceResolutionRequest {
  proposals: ExperienceCandidate[];
  destinationName?: string;
  destinationBoundary: unknown;
  traceContext?: Record<string, unknown>;
  evidence?: Array<{ key?: string; source: string; url?: string; title?: string; snippet?: string }>;
}

export interface ExperienceGeographicValidationResult {
  proposalName: string;
  kind: 'EXPERIENCE' | 'ROUTE' | 'AREA' | 'NEIGHBORHOOD_WALK' | 'POI';
  status: 'UNVERIFIED' | 'GROUNDED' | 'GEO_VERIFIED' | 'AUTHORITATIVELY_VERIFIED' | 'REJECTED';
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

export interface ExperienceResolutionResponse {
  totalProposals: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
  entityResolution?: ExperienceResolutionResponse;
  geographicValidation?: ExperienceGeographicValidationBatchResult;
  materialization?: ExperienceMaterializationResponse;
}

export interface ExperienceProposalResolver {
  resolve(request: ExperienceResolutionRequest): Promise<ExperienceResolutionResponse>;
}

export const EXPERIENCE_PROPOSAL_RESOLVER = 'EXPERIENCE_PROPOSAL_RESOLVER';
